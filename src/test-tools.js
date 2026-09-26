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
import { createPrefs } from "./prefs.js";
import { createPush, publishQuote } from "./push.js";
import { createSecurity } from "./security.js";
import { importSettingsDocument, settingsDocument } from "./settings.js";
import { PROMPTS, TOOL_COUNT } from "./create-server.js";
import { AUTHOR } from "./meta.js";
import { listSchemas, readSchema } from "./schemas.js";
import { VERSION } from "./version.js";

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
  assert(schemaNames.includes("quote") && schemaNames.includes("get_quote") && schemaNames.includes("server"), `schemas ${schemaNames.join(",")}`);
  assert(readSchema("quote").schema?.properties?.text?.type === "string", "quote schema text");
  assert(readSchema("server").schema?.properties?.version?.type === "string", "server schema version");
  assert(readSchema("server").description.includes(VERSION), "server schema description includes the version");
  assert(readSchema("describe_server").outputSchema?.properties?.server?.properties?.version?.type === "string", "describe_server schema version");
  assert(String(readSchema("set_protocols").next || "").includes("describe_server"), "set_protocols schema points at describe_server");
  assert(readSchema("export_log").description.includes("export_log") || readSchema("export_log").description.includes("trace"), "export_log schema description");
  const protocolRequired = readSchema("set_protocols").inputSchema?.required || [];
  assert(protocolRequired.includes("stdio") && protocolRequired.includes("streamableHttp") && protocolRequired.includes("sse"), `set_protocols required ${protocolRequired.join(",")}`);
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
    assert(log && log.at && log.tool === "get_quote" && log.caller === "apikey", "error log names the api key caller");
    const exported = security.exportLog();
    assert(exported.kind === "literature-clock-log" && exported.errors[0].caller === "apikey" && exported.invocations[0].caller === "apikey", "log export keeps the caller");
    security.setAuditMode(true);
    security.recordSuccess("list_sources", authed.principal, {});
    assert(security.exportLog().trace[0].caller === "apikey", "trace export names the caller");
    const prefs = createPrefs({ isSource: () => true });
    const push = createPush();
    const doc = settingsDocument(security, prefs, push);
    assert(doc.kind === "literature-clock-settings" && doc.push.mqtt.password === undefined && !doc.users.some((user) => user.password), "settings export omits secrets");
    doc.clock.hourClock = "12";
    doc.tools = doc.tools.map((tool) => tool.name === "get_quote" ? { ...tool, requireAuth: true } : tool);
    importSettingsDocument(doc, { security, prefs, push });
    assert(prefs.snapshot().hourClock === "12" && security.snapshot().toolAuthOverrides.get_quote === true, "settings import restores the clock and a lock");
    assert(security.setToolAuth("describe_server", true).toolAuthOverrides.describe_server === false, "describe_server cannot be locked");
    const closed = security.authorizeCall("list_users", {});
    assert(!closed.ok && closed.status === 401, "admin tool stays closed when auth is off");
    const protocolsClosed = security.authorizeCall("set_protocols", {});
    assert(!protocolsClosed.ok && protocolsClosed.status === 401, "set_protocols needs admin when auth is off");
    const readOnlyKey = security.issueKey({ label: "read", scopes: ["read"] });
    const missingAdmin = security.authorizeCall("create_user", { authorization: `Bearer ${readOnlyKey.key}` });
    assert(!missingAdmin.ok && missingAdmin.status === 403, "read key cannot create a user");
    const trafficClosed = security.authorizeCall("generate_traffic", {});
    assert(!trafficClosed.ok && trafficClosed.status === 401, "traffic needs a credential");
    const trafficOpen = security.authorizeCall("generate_traffic", { authorization: `Bearer ${readOnlyKey.key}` });
    assert(trafficOpen.ok, "read key can generate traffic");
  });

  withEnv({ AUTH_MODE: "off", RATE_LIMIT_ENABLED: "0", API_KEY: undefined, ADMIN_USER: "demo", ADMIN_PASSWORD: "demo" }, () => {
    const security = createSecurity();
    const basic = Buffer.from("demo:demo").toString("base64");
    const allowed = security.authorizeCall("list_users", { authorization: `Basic ${basic}` });
    assert(allowed.ok && allowed.scope === "admin", "admin password opens list_users");
  });

  const pushProbe = createPush();
  assert(pushProbe.snapshot().clientPush === false, "client push defaults off");
  pushProbe.update({ clientPush: true });
  assert(pushProbe.snapshot().clientPush === true, "client push turns on");
  let pushed = null;
  const sentQuote = await publishQuote({
    push: pushProbe,
    store,
    prefs: createPrefs({ isSource: () => true }),
    ensureEvents: true,
    deliver: async (payload, dest) => { pushed = { payload, dest }; },
  });
  assert(sentQuote.lines?.length && pushed?.dest?.events === true, "immediate push reaches the event stream");

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
      const readOnly = ![
        "update_settings",
        "push_quote",
        "create_user",
        "delete_user",
        "issue_api_key",
        "revoke_api_key",
        "import_settings",
        "push_quote_now",
        "generate_traffic",
        "set_clock",
        "set_auth_mode",
        "set_audit",
        "set_rate_limit",
        "set_protocols",
        "set_ui_auth",
        "set_tool_gate",
        "set_tool_lock",
        "set_push",
      ].includes(tool.name);
      assert(tool.annotations?.readOnlyHint === readOnly, `${tool.name} readOnlyHint`);
    }

    const described = await mcp(base, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "describe_server", arguments: {} },
    });
    assert(described.isError !== true && described.structuredContent?.ok === true, "describe structuredContent");
    assert(described.structuredContent?.server?.version === VERSION, "describe version");
    assert(String(described.structuredContent?.server?.description || "").includes(VERSION), "describe description");
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
    const serverSchema = await mcp(base, {
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "get_schema", arguments: { name: "server" } },
    }, { Authorization: "Bearer ink-test-key" });
    assert(serverSchema.structuredContent?.schema?.properties?.version?.type === "string", "get_schema server version");
    assert(String(serverSchema.structuredContent?.description || "").includes(VERSION), "get_schema server description");
    const settings = await mcp(base, {
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "get_settings", arguments: {} },
    }, { Authorization: "Bearer ink-test-key" });
    assert(settings.structuredContent?.version === VERSION, "get_settings version");
    const adminDenied = await mcp(base, {
      jsonrpc: "2.0", id: 13, method: "tools/call",
      params: { name: "list_users", arguments: {} },
    }, { Authorization: "Bearer ink-test-key" });
    assert(adminDenied.isError === true, "read key cannot list users");
    const basic = Buffer.from("demo:phase2-secret").toString("base64");
    const created = await mcp(base, {
      jsonrpc: "2.0", id: 14, method: "tools/call",
      params: { name: "create_user", arguments: { username: "ada", password: "clock-pass", scopes: ["read"] } },
    }, { Authorization: `Basic ${basic}` });
    assert(created.structuredContent?.username === "ada", "admin basic creates a user");
    const gated = await mcp(base, {
      jsonrpc: "2.0", id: 15, method: "tools/call",
      params: { name: "set_tool_gate", arguments: { tool: "count_lines", enabled: false } },
    }, { Authorization: `Basic ${basic}` });
    const gatedTool = gated.structuredContent?.tools?.find((tool) => tool.name === "count_lines");
    assert(gatedTool?.enabled === false && String(gated.structuredContent?.next || "").includes("describe_server"), "set_tool_gate");
    const protocols = await mcp(base, {
      jsonrpc: "2.0", id: 16, method: "tools/call",
      params: { name: "set_protocols", arguments: { stdio: true, streamableHttp: true, sse: false } },
    }, { Authorization: `Basic ${basic}` });
    assert(protocols.structuredContent?.protocols?.sse === false && protocols.structuredContent?.protocols?.stdio === true, "set_protocols");
    const exported = await mcp(base, {
      jsonrpc: "2.0", id: 17, method: "tools/call",
      params: { name: "export_settings", arguments: {} },
    }, { Authorization: `Basic ${basic}` });
    assert(exported.structuredContent?.document?.kind === "literature-clock-settings" && String(exported.structuredContent?.next || "").includes("import_settings"), "export_settings chain");
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
