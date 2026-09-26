/**
 * Phase 1 — store and security in-process.
 * Phase 2 — HTTP wire: tools, resources, prompts, completion, outputSchema, auth, CORS.
 *
 *   node src/test-tools.js
 *   node src/test-tools.js --phase1
 *   node src/test-tools.js --phase2
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createStore } from "./store.js";
import { createSecurity } from "./security.js";
import { PROMPTS, TOOL_COUNT } from "./create-server.js";
import { AUTHOR } from "./meta.js";
import { listSchemas, readSchema } from "./schemas.js";

const only = process.argv.includes("--phase1") ? 1 : process.argv.includes("--phase2") ? 2 : 0;
let failed = 0;

function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${message}`);
  }
}

function withEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function phase1() {
  const store = createStore();
  const catalog = store.sourceCatalog();
  assert(catalog.some((item) => item.id === "literature"), "literature in list_sources");
  const yoda = await store.quotePayload({ time: "09:05", source: "yoda" });
  assert(yoda.ok && yoda.lines[0].source === "yoda", "store yoda line");
  const literature = await store.quotePayload({ time: "09:05", source: "literature" });
  assert(literature.ok && literature.lines[0].source === "literature", "store literature line");
  const counts = store.countLines(store.stampOf("09:05"));
  assert(counts.voices.some((item) => item.id === "yoda" && item.count === 1), "count_lines yoda");
  const schemaNames = listSchemas().map((item) => item.name);
  assert(schemaNames.includes("quote") && schemaNames.includes("get_quote"), `schemas ${schemaNames.join(",")}`);
  assert(readSchema("quote").schema?.properties?.text?.type === "string", "quote schema text");
  assert(readSchema("get_quote").inputSchema?.properties?.source, "get_quote input schema");
  let unknownSchema = false;
  try { readSchema("not-a-schema"); } catch (error) { unknownSchema = error.code === "bad_schema"; }
  assert(unknownSchema, "unknown schema");
  assert(AUTHOR.name === "Markus van Kempen" && AUTHOR.url.startsWith("https://") && AUTHOR.github.startsWith("https://github.com/") && !AUTHOR.email, "author");
  withEnv({ AUTH_MODE: "off", RATE_LIMIT_ENABLED: "0", PROTOCOL_STDIO: undefined, PROTOCOL_HTTP: undefined, PROTOCOL_SSE: undefined, UI_REQUIRE_AUTH: undefined }, () => {
    const security = createSecurity();
    const protocols = security.snapshot().protocols;
    assert(protocols.stdio && protocols.streamableHttp && protocols.sse, "protocols default on");
    security.setProtocols({ sse: false });
    assert(security.snapshot().protocols.sse === false && security.protocolOn("sse") === false, "sse off");
    let blocked = false;
    try { security.setProtocols({ stdio: false, streamableHttp: false, sse: false }); }
    catch (error) { blocked = error.code === "bad_protocol"; }
    assert(blocked && security.snapshot().protocols.stdio === true, "one protocol stays on");
    security.setUiRequireAuth(true);
    assert(security.snapshot().uiRequireAuth === true, "pages require sign-in");
    let savedUsers = null;
    const withUsers = createSecurity({ onChange: (state) => { savedUsers = state; } });
    const created = withUsers.addUser("ada", "clock-pass", ["read", "admin"]);
    assert(created.ok && withUsers.login("Ada", "clock-pass"), "created user can sign in");
    assert(!withUsers.login("ada", "nope"), "wrong password rejected");
    const listed = withUsers.snapshot().users.find((user) => user.username === "ada");
    assert(listed && !listed.password && !listed.passwordHash, "user list hides the password");
    assert(savedUsers?.users?.[0]?.passwordHash && !JSON.stringify(savedUsers).includes("clock-pass"), "password stored as a hash");
    assert(!withUsers.addUser("demo", "other-pass", ["admin"]).ok, "cannot replace built-in admin");
    assert(withUsers.deleteUser("ada").ok && !withUsers.login("ada", "clock-pass"), "deleted user cannot sign in");
  });

  withEnv({ AUTH_MODE: "off", RATE_LIMIT_ENABLED: "0", API_KEY: undefined, TENANT_ID: undefined }, () => {
    const security = createSecurity();
    const open = security.authorizeCall("get_quote", {});
    assert(open.ok, "auth off allows get_quote");
    security.setToolGate("get_quote", false);
    const disabled = security.authorizeCall("get_quote", {});
    assert(!disabled.ok && disabled.status === 503, "tool gate 503");
    security.setToolGate("get_quote", true);
    security.setToolAuth("list_sources", true);
    const locked = security.authorizeCall("list_sources", {});
    assert(!locked.ok && locked.status === 401, "per-tool auth lock");
    const issued = security.issueKey({ label: "phase1", scopes: ["read"] });
    const authed = security.authorizeCall("list_sources", { authorization: `Bearer ${issued.key}` });
    assert(authed.ok && authed.principal.type === "apikey", "api key principal");
    security.recordError("get_quote", authed.principal, { time: "99:99" }, "bad time");
    const log = security.snapshot().errorLog[0];
    assert(log && log.at && log.tool === "get_quote", "error log timestamp");
  });

  withEnv({ AUTH_MODE: "all", RATE_LIMIT_ENABLED: "0", API_KEY: undefined }, () => {
    const security = createSecurity();
    const discover = security.authorizeCall("describe_server", {});
    assert(discover.ok, "describe_server stays open");
    const denied = security.authorizeCall("get_quote", {});
    assert(!denied.ok && denied.status === 401 && !denied.error.includes("forbidden"), "auth all denial has guidance");
  });

  withEnv({ AUTH_MODE: "off", RATE_LIMIT: "2", RATE_LIMIT_WINDOW_MS: "60000", RATE_LIMIT_ENABLED: undefined, API_KEY: undefined }, () => {
    const security = createSecurity();
    assert(security.authorizeCall("get_quote", {}).ok, "rate 1");
    assert(security.authorizeCall("get_quote", {}).ok, "rate 2");
    const limited = security.authorizeCall("get_quote", {});
    assert(!limited.ok && limited.status === 429 && limited.retryAfterSec >= 1, "rate limit retry_after");
  });
  console.log("phase 1 ok");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

async function mcp(base, body, headers = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const line = text.split("\n").find((row) => row.startsWith("data: ")) || text;
  const json = JSON.parse(line.replace(/^data: /, ""));
  return json.result ?? json;
}

async function phase2() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      MCP_MODE: "http",
      PORT: String(port),
      HOST: "127.0.0.1",
      AUTH_MODE: "all",
      INK_CLOCK_IGNORE_STATE: "1",
      API_KEY: "ink-test-key",
      API_KEY_SCOPES: "read",
      RATE_LIMIT_ENABLED: "0",
      ADMIN_USER: "demo",
      ADMIN_PASSWORD: "phase2-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    child.stderr.on("data", () => {
      if (stderr.includes("http on")) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });
  assert(ready, `http did not start\n${stderr}`);
  if (!ready) {
    child.kill();
    return;
  }

  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert(health.ok && health.transport === "http" && health.tools === TOOL_COUNT && health.version, "health");

    const test = await (await fetch(`${base}/test?format=json`)).json();
    assert(test.ok && test.writes === false && !test.steps.some((step) => step.name.includes("create")), "/test read-only");

    const listed = await mcp(base, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert(listed.tools?.length === TOOL_COUNT, `tools/list count ${listed.tools?.length}`);
    for (const tool of listed.tools || []) {
      assert(tool.outputSchema?.properties, `${tool.name} outputSchema`);
      assert(tool.annotations?.openWorldHint === false, `${tool.name} openWorldHint`);
      const readOnly = tool.name !== "update_settings";
      assert(tool.annotations?.readOnlyHint === readOnly, `${tool.name} readOnlyHint`);
    }

    const described = await mcp(base, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "describe_server", arguments: {} },
    });
    assert(described.isError !== true && described.structuredContent?.ok === true, "describe structuredContent");
    assert(described.structuredContent?.author?.name === "Markus van Kempen", "describe author");
    assert(described.content?.[0]?.text?.includes("literature-clock-mcp"), "describe text");

    const denied = await mcp(base, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "get_quote", arguments: { time: "09:05", source: "yoda" } },
    });
    assert(denied.isError === true, "get_quote denied without key");
    const deniedBody = JSON.parse(denied.content[0].text);
    assert(deniedBody.denied === true && deniedBody.status === 401 && deniedBody.next, "denial contract");

    const quote = await mcp(base, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "get_quote", arguments: { time: "09:05", source: "yoda" } },
    }, { Authorization: "Bearer ink-test-key" });
    assert(quote.structuredContent?.lines?.[0]?.source === "yoda", "get_quote structured line");

    const blocked = await mcp(base, {
      jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "update_settings", arguments: { defaultSource: "pirate" } },
    }, { Authorization: "Bearer ink-test-key" });
    assert(blocked.isError === true, "read key cannot update_settings");

    const schemas = await mcp(base, {
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "list_schemas", arguments: {} },
    }, { Authorization: "Bearer ink-test-key" });
    assert(schemas.structuredContent?.schemas?.some((item) => item.name === "quote"), "list_schemas");
    const schema = await mcp(base, {
      jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "get_schema", arguments: { name: "quote" } },
    }, { Authorization: "Bearer ink-test-key" });
    assert(schema.structuredContent?.schema?.properties?.text?.type === "string", "get_schema quote");
    const docs = await (await fetch(`${base}/help?format=json`)).json();
    assert(docs.author?.url === "https://markusvankempen.github.io/" && docs.author?.github === "https://github.com/markusvankempen/" && !docs.author?.email, "docs author");
    const openTraffic = await fetch(`${base}/test/traffic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ rounds: 1 }),
    });
    assert(openTraffic.status === 401, `traffic without auth ${openTraffic.status}`);
    const traffic = await (await fetch(`${base}/test/traffic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer ink-test-key",
      },
      body: JSON.stringify({ rounds: 1 }),
    })).json();
    assert(traffic.ok && traffic.calls >= 5 && traffic.failed >= 1, `traffic ${traffic.calls}/${traffic.failed}`);

    const resources = await mcp(base, { jsonrpc: "2.0", id: 5, method: "resources/list" }, { Authorization: "Bearer ink-test-key" });
    const uris = (resources.resources || []).map((item) => item.uri);
    assert(uris.includes("sources://list"), "sources resource");
    assert(uris.some((uri) => uri.startsWith("quote://")), "quote template instances");

    const prompts = await mcp(base, { jsonrpc: "2.0", id: 6, method: "prompts/list" });
    const names = (prompts.prompts || []).map((item) => item.name);
    for (const name of PROMPTS) assert(names.includes(name), `prompt ${name}`);

    const completed = await mcp(base, {
      jsonrpc: "2.0",
      id: 7,
      method: "completion/complete",
      params: {
        ref: { type: "ref/resource", uri: "quote://{source}/{hhmm}" },
        argument: { name: "source", value: "pir" },
      },
    });
    assert((completed.completion?.values || []).includes("pirate"), `completion ${JSON.stringify(completed)}`);

    const foreign = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "http://evil.example" } });
    assert(foreign.status === 403, `foreign origin ${foreign.status}`);
    const local = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:6274" } });
    assert(local.status === 204, `loopback preflight ${local.status}`);

    const login = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "phase2-secret" }),
    });
    const cookie = login.headers.getSetCookie?.()?.[0] || login.headers.get("set-cookie") || "";
    const log = await fetch(`${base}/log`, { headers: { Cookie: cookie.split(";")[0] } });
    assert(log.status === 200, `/log ${log.status}`);
    console.log("phase 2 ok");
  } finally {
    child.kill();
  }
}

if (only !== 2) await phase1();
if (only !== 1) await phase2();
if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("test-tools ok");
