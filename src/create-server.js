import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { AUTHOR, HOME } from "./meta.js";
import { SERVER_DESCRIPTION, VERSION } from "./version.js";
import { createPush } from "./push.js";
import { applySettings, importSettingsDocument, settingsDocument, settingsPayload } from "./settings.js";
import { generateTraffic } from "./traffic.js";
import { createPrefs } from "./prefs.js";
import { Line, Source, jsonSchema, listSchemas, publishSchema, readSchema } from "./schemas.js";

export const TOOL_CATALOG = [
  ["describe_server", "read", `Call first, and after any denial. Returns version ${VERSION}, the server description, auth mode, your scopes, rate limit, and every tool`],
  ["list_sources", "read", "Literature, Books, Mix all, Surprise me, and every original voice id"],
  ["get_quote", "read", "A line for one clock minute. Omit source to use the saved default. avoid skips a line you already have"],
  ["count_lines", "read", "How many local lines each source has for one minute. Does not fetch the online library"],
  ["get_settings", "read", "Read the server version, clock defaults, auth mode, rate limit, which tools are enabled, and the quote schedule"],
  ["update_settings", "write", "Change several Settings fields in one call. Needs the write scope, which is open when auth mode is off. For one Settings form with the page's admin sign-in, use set_clock, set_auth_mode, set_audit, set_rate_limit, set_protocols, set_ui_auth, set_tool_gate, set_tool_lock, or set_push"],
  ["list_schemas", "read", "Names of the server, line, source, settings, and tool schemas. Call this before get_schema"],
  ["get_schema", "read", "JSON Schema for one name from list_schemas. server includes the version. A tool name returns that tool's inputSchema and outputSchema"],
  ["push_quote", "write", "Send the current quote to open GET /events clients now. Off until clientPush is on"],
  ["list_users", "admin", "Settings → Users. Names and scopes only. Needs an admin credential even when auth mode is off"],
  ["create_user", "admin", "Settings → Users → Save user. Needs an admin credential"],
  ["delete_user", "admin", "Settings → Users → Remove. The built-in admin and environment users stay. Needs an admin credential"],
  ["list_api_keys", "admin", "Settings → API keys. Prefix, label, and scopes. The secret is not returned. Needs an admin credential"],
  ["issue_api_key", "admin", "Settings → API keys → Issue key. The secret is returned once. Needs an admin credential"],
  ["revoke_api_key", "admin", "Settings → API keys → Revoke. Needs an admin credential"],
  ["export_settings", "admin", "Settings → Backup → Export settings. Needs admin. Includes saved-user password hashes. Omits API keys and the MQTT password. Pass document to import_settings to restore it, then call get_settings"],
  ["import_settings", "admin", "Settings → Backup → Import settings. Needs admin. Pass the document from export_settings. Then call get_settings to confirm clock, auth, protocols, schedule, and tool gates"],
  ["export_log", "admin", "Log → Export log and trace. Needs admin. Call set_audit with auditMode true first if you need the trace. Call generate_traffic first if you want sample rows. Then read document.trace and document.errors"],
  ["push_quote_now", "admin", "Settings → Push → Push a quote now. Needs admin. Uses saved destinations only. Call set_push first. Open GET /events to see the line"],
  ["generate_traffic", "read", "Test → Generate traffic. Needs any credential even when auth mode is off. Does not change quotes or settings. Then call export_log"],
  ["set_clock", "admin", "Settings → Clock → Save clock. Needs admin. Send defaultSource, defaultCount, timeZone, and hourClock. Then call get_quote and omit source to use the saved default"],
  ["set_auth_mode", "admin", "Settings → Security → Apply mode. Needs admin. authMode is off, write, or all. Then call describe_server. Admin tools still need the admin scope"],
  ["set_audit", "admin", "Settings → Security → Call trace. Needs admin. auditMode true records every call. Then call generate_traffic and export_log"],
  ["set_rate_limit", "admin", "Settings → Security → Rate limit. Needs admin. Send enabled, limit, and windowSeconds. Then call describe_server and read rate_limit"],
  ["set_protocols", "admin", "Settings → Protocols → Save protocols. Needs admin. Send stdio, streamableHttp, and sse. At least one must be true. Then call describe_server and read protocols"],
  ["set_ui_auth", "admin", "Settings → Protocols → Hide every page until sign-in. Needs admin. Then call get_settings and read uiRequireAuth. Tool calls stay available"],
  ["set_tool_gate", "admin", "Settings → Tool gates → Enable or Disable. Needs admin. describe_server cannot be disabled. Then call describe_server and read tools[].available"],
  ["set_tool_lock", "admin", "Settings → Tool gates → Lock or Remove lock. Needs admin. A lock requires a credential even when auth mode is off. describe_server cannot be locked. Then call describe_server and read credential_required_now"],
  ["set_push", "admin", "Settings → Push → Save schedule. Needs admin. Send the interval, clientPush, and every destination. Interval 0 is off; otherwise 5, 10, 15, 30, or 60, and at least one destination. Then call push_quote_now, or push_quote when clientPush is true"],
];

export const TOOL_COUNT = TOOL_CATALOG.length;

export const PROMPTS = [
  "diagnose-server",
  "quote-for-now",
  "another-line",
  "mix-the-minute",
  "voice-at-nine",
  "books-for-a-minute",
  "read-settings",
];

const INSTRUCTIONS = `\
You are connected to literature-clock-mcp ${VERSION}. ${SERVER_DESCRIPTION}

Rules:
1. Call describe_server first, and again after any denial. It tells you the auth mode, your scopes, and every tool.
2. Time is HH:MM (24-hour) or "now". There is no date. source is literature, books, mix, surprise, or a voice id from list_sources.
3. An empty lines array means that minute has no row. Try literature, books, or mix. Do not invent a quotation and do not retry the same arguments.
4. Pass avoid set to the previous line text to get a different line for the same minute.
5. Follow the next field once. Do not retry a denied call in a loop.
6. Clock defaults live in get_settings. Change one Settings form with set_clock, set_auth_mode, set_audit, set_rate_limit, set_protocols, set_ui_auth, set_tool_gate, set_tool_lock, or set_push. Those need the admin scope. update_settings changes several fields and needs the write scope.
7. Call list_schemas, then get_schema with one name, before guessing fields. The server schema includes the version. A tool schema includes inputSchema, outputSchema, and what to call next.
8. A schedule can push the current quote on GET /events, on open SSE and Streamable HTTP sessions, and to an MQTT broker. It is off until set_push or update_settings turns it on. Do not wait for a push. Call get_quote. push_quote sends one line immediately when clientPush is on. push_quote_now uses the saved destinations and needs admin.
9. Backup is export_settings then import_settings. The log is set_audit, then generate_traffic, then export_log. Users are list_users, create_user, and delete_user. Keys are list_api_keys, issue_api_key, and revoke_api_key. Follow each tool's next field once.`;

const PushView = z.object({
  everyMinutes: z.number(),
  destinations: z.object({
    events: z.boolean(),
    sse: z.boolean(),
    streamableHttp: z.boolean(),
    mqtt: z.boolean(),
  }),
  mqtt: z.object({
    url: z.string(),
    topic: z.string(),
    username: z.string(),
    clientId: z.string(),
    passwordSet: z.boolean(),
  }),
  live: z.object({
    events: z.number(),
    sse: z.number(),
    streamableHttp: z.number(),
  }),
  last: z.object({
    at: z.string(),
    time: z.string(),
    ok: z.boolean(),
    error: z.string(),
  }),
});

const CLOSED = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const OUT = {
  describe_server: z.object({
    ok: z.boolean(),
    server: z.object({
      name: z.string(),
      title: z.string(),
      version: z.string().describe("Package version. Same string as the page header and the server schema."),
      description: z.string().describe("Server description, including the version."),
      tool_count: z.number(),
      homepage: z.string(),
    }),
    author: z.object({
      name: z.string(),
      url: z.string(),
      github: z.string(),
      tagline: z.string(),
    }),
    you: z.object({
      principal: z.string(),
      type: z.string(),
      authenticated: z.boolean(),
      scopes: z.array(z.string()),
      effective_scopes: z.array(z.string()),
      problem: z.string(),
    }),
    auth: z.object({
      mode: z.string(),
      modes: z.array(z.string()),
      meaning: z.string(),
      accepted: z.string(),
      active_api_keys: z.number(),
    }),
    rate_limit: z.object({
      enabled: z.boolean(),
      limit: z.number(),
      windowMs: z.number(),
      used: z.number(),
      remaining: z.number(),
      resetInMs: z.number(),
    }),
    tools: z.array(z.object({
      name: z.string(),
      required_scope: z.string(),
      credential_required_now: z.boolean(),
      available: z.boolean(),
      purpose: z.string(),
    })),
    resources: z.array(z.object({ uri: z.string(), description: z.string() })),
    prompts: z.array(z.string()),
    clock: z.object({
      defaultSource: z.string(),
      defaultCount: z.number(),
      timeZone: z.string(),
      hourClock: z.string(),
    }),
    protocols: z.object({
      stdio: z.boolean(),
      streamableHttp: z.boolean(),
      sse: z.boolean(),
    }),
    ui: z.object({ requireAuth: z.boolean() }),
    push: PushView,
    next: z.string(),
  }),
  list_sources: z.object({
    ok: z.boolean(),
    sources: z.array(Source),
    next: z.string(),
  }),
  get_quote: z.object({
    ok: z.boolean(),
    time: z.string(),
    requested_source: z.string(),
    requested_label: z.string(),
    lines: z.array(Line),
    next: z.string(),
  }),
  count_lines: z.object({
    ok: z.boolean(),
    time: z.string(),
    books: z.number(),
    literature_local: z.number(),
    mix: z.number(),
    voices: z.array(z.object({
      id: z.string(),
      label: z.string(),
      count: z.number(),
    })),
    next: z.string(),
  }),
  settings: z.object({
    ok: z.boolean(),
    version: z.string().describe("Package version shown in the page header."),
    clock: z.object({
      defaultSource: z.string(),
      defaultCount: z.number(),
      timeZone: z.string(),
      hourClock: z.string(),
    }),
    authMode: z.string(),
    authModes: z.array(z.string()),
    rateLimit: z.object({
      enabled: z.boolean(),
      limit: z.number(),
      windowMs: z.number(),
    }),
    auditMode: z.boolean(),
    protocols: z.object({
      stdio: z.boolean(),
      streamableHttp: z.boolean(),
      sse: z.boolean(),
    }),
    uiRequireAuth: z.boolean(),
    push: PushView,
    tools: z.array(z.object({
      name: z.string(),
      scope: z.string(),
      enabled: z.boolean(),
      requireAuth: z.boolean(),
    })),
    activeApiKeys: z.number(),
    next: z.string(),
  }),
  list_schemas: z.object({
    ok: z.boolean(),
    schemas: z.array(z.object({
      name: z.string(),
      kind: z.string(),
      title: z.string(),
      description: z.string(),
    })),
    next: z.string(),
  }),
  get_schema: z.object({
    ok: z.boolean(),
    name: z.string(),
    kind: z.string(),
    title: z.string(),
    description: z.string(),
    schema: z.any(),
    inputSchema: z.any().optional(),
    outputSchema: z.any().optional(),
    next: z.string(),
  }),
  list_users: z.object({
    ok: z.boolean(),
    users: z.array(z.object({
      username: z.string(),
      scopes: z.array(z.string()),
      source: z.string(),
    })),
  }),
  create_user: z.object({
    ok: z.boolean(),
    username: z.string(),
  }),
  delete_user: z.object({
    ok: z.boolean(),
  }),
  list_api_keys: z.object({
    ok: z.boolean(),
    keys: z.array(z.object({
      id: z.string(),
      label: z.string(),
      prefix: z.string(),
      scopes: z.array(z.string()),
      active: z.boolean(),
    })),
  }),
  issue_api_key: z.object({
    ok: z.boolean(),
    key: z.string(),
    id: z.string(),
    prefix: z.string(),
    scopes: z.array(z.string()),
  }),
  revoke_api_key: z.object({
    ok: z.boolean(),
    id: z.string(),
  }),
  export_settings: z.object({
    ok: z.boolean(),
    version: z.string(),
    document: z.record(z.string(), z.any()),
    next: z.string(),
  }),
  import_settings: z.object({
    ok: z.boolean(),
    version: z.string(),
    next: z.string(),
  }),
  export_log: z.object({
    ok: z.boolean(),
    version: z.string(),
    document: z.record(z.string(), z.any()),
    next: z.string(),
  }),
  push_quote_now: z.object({
    ok: z.boolean(),
    at: z.string(),
    time: z.string(),
    requested_source: z.string(),
    requested_label: z.string(),
    lines: z.array(Line),
  }),
  generate_traffic: z.object({
    ok: z.boolean(),
    rounds: z.number(),
    calls: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    stopped: z.string(),
  }),
};

const INPUT = {
  get_quote: {
    time: z.string().optional().describe('HH:MM, h:mm AM/PM, or "now". Defaults to now.'),
    source: z.string().optional().describe("literature, books, mix, surprise, or a voice id from list_sources. Omit to use the saved default."),
    avoid: z.string().optional().describe("Plain line text to skip so the next call can return another line."),
    count: z.number().int().min(1).max(8).optional().describe("How many distinct lines. Defaults to 1."),
  },
  count_lines: {
    time: z.string().optional().describe('HH:MM, h:mm AM/PM, or "now". Defaults to now.'),
  },
  update_settings: {
    defaultSource: z.string().optional().describe("literature, books, mix, surprise, or a voice id."),
    defaultCount: z.number().int().min(1).max(8).optional().describe("Lines returned when count is omitted."),
    timeZone: z.string().optional().describe("device, or an IANA zone such as America/Toronto."),
    hourClock: z.enum(["12", "24"]).optional().describe("12-hour or 24-hour clock in the header and on the clock page."),
    authMode: z.enum(["off", "write", "all"]).optional(),
    rateLimitEnabled: z.boolean().optional(),
    rateLimit: z.number().int().min(1).optional().describe("Calls allowed per window."),
    rateLimitWindowSec: z.number().int().min(1).optional(),
    auditMode: z.boolean().optional(),
    tool: z.string().optional().describe("One tool name to enable, disable, or lock."),
    toolEnabled: z.boolean().optional(),
    toolRequireAuth: z.boolean().optional().describe("Require a credential for this tool even when auth mode is off."),
    stdioEnabled: z.boolean().optional().describe("stdio transport. At least one protocol must stay on."),
    streamableHttpEnabled: z.boolean().optional().describe("POST /mcp. At least one protocol must stay on."),
    sseEnabled: z.boolean().optional().describe("GET /sse. At least one protocol must stay on."),
    uiRequireAuth: z.boolean().optional().describe("Hide the HTML pages until someone signs in at /admin."),
    pushEveryMinutes: z.number().int().optional().describe("0 is off. Otherwise 5, 10, 15, 30, or 60. The HTTP process pushes the current quote on that interval."),
    clientPush: z.boolean().optional().describe("Allow push_quote to send the current line to GET /events immediately."),
    pushEvents: z.boolean().optional().describe("Push on GET /events as an SSE event named quote."),
    pushSse: z.boolean().optional().describe("Push notifications/literature-clock/quote on open legacy SSE sessions."),
    pushHttp: z.boolean().optional().describe("Push that notification on open Streamable HTTP sessions."),
    mqttEnabled: z.boolean().optional().describe("Publish the same quote JSON to an MQTT broker."),
    mqttUrl: z.string().optional().describe("mqtt://host:port or mqtts://host:port. Put the username and password in their own fields."),
    mqttTopic: z.string().optional().describe("Broker topic. Default literature-clock/quote."),
    mqttUsername: z.string().optional(),
    mqttPassword: z.string().optional().describe("Stored for the broker. get_settings never returns it. Omit to keep the saved password."),
    mqttClientId: z.string().optional().describe("Default literature-clock."),
    mqttClearPassword: z.boolean().optional().describe("Remove the saved MQTT password."),
  },
  get_schema: {
    name: z.string().describe("A name from list_schemas: server, quote, source, settings, or a tool name."),
  },
  create_user: {
    username: z.string().describe("2–32 letters, numbers, dots, or dashes. Not the built-in admin name."),
    password: z.string().describe("4–128 characters. Stored as a hash. Not returned."),
    scopes: z.array(z.enum(["read", "write", "admin"])).min(1).describe("At least one of read, write, or admin."),
  },
  delete_user: {
    username: z.string(),
  },
  issue_api_key: {
    label: z.string().optional().describe("Shown in Settings → API keys. Default unnamed key."),
    scopes: z.array(z.enum(["read", "write", "pii", "admin"])).optional().describe("Default read."),
    expiresInDays: z.number().int().min(1).optional().describe("Omit for a key that does not expire."),
  },
  revoke_api_key: {
    id: z.string().describe("The id from list_api_keys, not the secret."),
  },
  import_settings: {
    document: z.union([z.string(), z.record(z.string(), z.any())]).describe("A settings export from export_settings, as an object or a JSON string."),
  },
  generate_traffic: {
    rounds: z.number().int().min(1).max(20).optional().describe("Default 5. Each round reads quotes and records a bad time, an unknown schema, and a rejected key. Then call export_log."),
  },
  set_clock: {
    defaultSource: z.string().describe("literature, books, mix, surprise, or a voice id from list_sources."),
    defaultCount: z.number().int().min(1).max(8),
    timeZone: z.string().describe("device, or an IANA zone such as America/Toronto."),
    hourClock: z.enum(["12", "24"]),
  },
  set_auth_mode: {
    authMode: z.enum(["off", "write", "all"]).describe("off: quote tools are open. write: update_settings and push_quote need a key. all: every tool except describe_server needs a key. Admin tools always need admin."),
  },
  set_audit: {
    auditMode: z.boolean().describe("true records every tool call for export_log. Then call generate_traffic and export_log."),
  },
  set_rate_limit: {
    enabled: z.boolean(),
    limit: z.number().int().min(1).describe("Calls allowed per window."),
    windowSeconds: z.number().int().min(1),
  },
  set_protocols: {
    stdio: z.boolean().describe("Cursor and VS Code. At least one of stdio, streamableHttp, and sse must be true."),
    streamableHttp: z.boolean().describe("POST /mcp, including Run on the Tools page."),
    sse: z.boolean().describe("Legacy GET /sse."),
  },
  set_ui_auth: {
    enabled: z.boolean().describe("true hides HTML pages until sign-in. Tool calls stay available."),
  },
  set_tool_gate: {
    tool: z.string().describe("A name from describe_server.tools. describe_server cannot be disabled."),
    enabled: z.boolean().describe("false hides the tool from every caller."),
  },
  set_tool_lock: {
    tool: z.string().describe("A name from describe_server.tools. describe_server cannot be locked."),
    requireAuth: z.boolean().describe("true requires a credential even when auth mode is off."),
  },
  set_push: {
    pushEveryMinutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).describe("0 is off. Otherwise the minute must match, such as :00, :05, :10."),
    clientPush: z.boolean().describe("Allow push_quote to send one line now."),
    pushEvents: z.boolean().describe("GET /events, event name quote."),
    pushSse: z.boolean().describe("Open legacy SSE sessions."),
    pushHttp: z.boolean().describe("Open Streamable HTTP sessions."),
    mqttEnabled: z.boolean(),
    mqttUrl: z.string().optional().describe("Required when mqttEnabled is true. mqtt://host:port."),
    mqttTopic: z.string().optional(),
    mqttUsername: z.string().optional(),
    mqttPassword: z.string().optional().describe("Omit to keep the saved password. get_settings never returns it."),
    mqttClientId: z.string().optional(),
    mqttClearPassword: z.boolean().optional(),
  },
};

function publishToolSchema(name, title, description, input, output, next) {
  const inputSchema = jsonSchema(input);
  const outputSchema = jsonSchema(output);
  publishSchema({
    name,
    kind: "tool",
    title,
    description,
    schema: {
      type: "object",
      properties: { inputSchema: inputSchema, outputSchema: outputSchema },
      required: ["inputSchema", "outputSchema"],
    },
    inputSchema,
    outputSchema,
    next,
  });
}

const CHAIN = {
  describe_server: "Call list_sources, then get_quote. To change Settings, call get_settings, then one set_* tool.",
  list_sources: "Call get_quote. Omit source to use the saved default from get_settings.",
  get_quote: "Pass avoid set to the previous line text for Another line. Pass source surprise for Random.",
  count_lines: "Call get_quote for a voice whose count is greater than 0, or use literature or books.",
  get_settings: "Change one form with set_clock, set_auth_mode, set_audit, set_rate_limit, set_protocols, set_ui_auth, set_tool_gate, set_tool_lock, or set_push. update_settings changes several fields and needs the write scope.",
  update_settings: "Call get_settings to confirm. If a tool gate changed, call describe_server.",
  list_schemas: "Call get_schema with one name. server includes the version. A tool name includes inputSchema, outputSchema, and the next call.",
  get_schema: "Call the tool whose inputSchema you just read. Follow that schema's next text.",
  push_quote: "Subscribe to GET /events first. Turn clientPush on with set_push before this call.",
  list_users: "Call create_user to add a name, or delete_user with a saved username. The built-in admin is not removed.",
  create_user: "Call list_users. The password is not returned.",
  delete_user: "Call list_users to confirm.",
  list_api_keys: "Call issue_api_key to create one. Revoke with revoke_api_key and the id, not the secret.",
  issue_api_key: "Copy key now. It is not shown again. Later call list_api_keys, or revoke_api_key with id.",
  revoke_api_key: "Call list_api_keys. active is false for a revoked key.",
  export_settings: "Pass document unchanged to import_settings. API keys, ADMIN_PASSWORD, and the MQTT password are not in the file.",
  import_settings: "Call get_settings to confirm clock, auth, protocols, schedule, and tool gates.",
  export_log: "If trace is empty, call set_audit with auditMode true, then generate_traffic, then export_log again.",
  push_quote_now: "Call set_push first so a destination is saved. Open GET /events to see the line.",
  generate_traffic: "Call export_log to read counters, errors, and the trace. Quotes and settings are unchanged.",
  set_clock: "Call get_quote and omit source to use the saved default.",
  set_auth_mode: "Call describe_server. auth.mode is the new mode. Admin tools still need the admin scope.",
  set_audit: "Call generate_traffic, then export_log. The trace fills only while audit is on.",
  set_rate_limit: "Call describe_server and read rate_limit.",
  set_protocols: "Call describe_server and read protocols. At least one protocol stays on.",
  set_ui_auth: "Call get_settings and read uiRequireAuth. Tool calls stay available.",
  set_tool_gate: "Call describe_server and read tools[].available. describe_server cannot be disabled.",
  set_tool_lock: "Call describe_server and read credential_required_now. describe_server cannot be locked.",
  set_push: "Call push_quote_now to send one line on the saved destinations. push_quote also needs clientPush.",
};

for (const [name, scope, purpose] of TOOL_CATALOG) {
  const input = INPUT[name] || {};
  const output = OUT[name] || (name === "get_settings" || name === "update_settings" || name.startsWith("set_") ? OUT.settings : null);
  if (!output) continue;
  publishToolSchema(name, name, purpose, input, output, CHAIN[name] || `Call ${name} with arguments that match inputSchema.`);
}

function json(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function redact(params) {
  if (!params || typeof params !== "object") return params;
  const copy = { ...params };
  for (const key of ["password", "mqttPassword", "document"]) {
    if (copy[key] !== undefined) copy[key] = "[redacted]";
  }
  return copy;
}

function fail(message, extra = {}) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: false,
        error: message,
        next: extra.next || "Follow the error text. Call describe_server if you are unsure which tool to use. Do not retry this exact call.",
        ...extra,
      }, null, 2),
    }],
  };
}

function denied(result) {
  const next = result.reason === "protocol disabled"
    ? "This protocol is off. Turn it on under Settings → Protocols, or call update_settings. describe_server still answers."
    : result.status === 429
    ? `Wait ${result.retryAfterSec || "the stated"} seconds, then retry once. Do not retry in a loop. Call describe_server to see your remaining rate-limit budget.`
    : result.status === 503
      ? "Call describe_server — it lists which tools are currently available. Do not retry this tool until an administrator enables it."
      : "Call describe_server to see the auth mode and the scopes you hold. Present a credential with the scope named in the error (Authorization: Bearer <api key> from /admin, or MCP_API_KEY over stdio), then retry this tool once.";
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: false,
        error: result.error,
        status: result.status,
        denied: true,
        principal: result.principal?.label || "anonymous",
        retry_after_seconds: result.retryAfterSec,
        next,
      }, null, 2),
    }],
  };
}

function resourceJson(uri, data) {
  return {
    contents: [{
      uri: String(uri.href || uri),
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function resourceDenied(result) {
  throw new McpError(ErrorCode.InvalidRequest, result.error || "denied", {
    ok: false,
    denied: true,
    status: result.status,
    next: "Call describe_server to see the auth mode and your scopes.",
  });
}

function optionalCompletable(schema, complete) {
  return completable(completable(schema, complete).optional(), complete);
}

function meaning(mode) {
  const admin = "Users, API keys, backup, the log, and push_quote_now need the admin scope even when auth mode is off.";
  if (mode === "all") return `Every tool except describe_server needs a credential. ${admin}`;
  if (mode === "write") return `update_settings and push_quote need a credential. Read tools stay open. ${admin}`;
  return `No credential needed for quote tools. ${admin} generate_traffic needs any credential.`;
}

function nextFor(mode, authenticated) {
  if (mode === "all" && !authenticated) {
    return "Auth mode is all. Send Authorization: Bearer <api key> or set MCP_API_KEY, then call list_sources and get_quote.";
  }
  return "Call list_sources, then get_quote. Omit time for the current minute. Omit source to use the saved default.";
}

export function createMcpServer({ store, security, prefs, push, pushNow, requestHeaders = () => ({}), onToolsChanged = () => {} }) {
  const clockPrefs = prefs || createPrefs();
  const outlet = push || createPush();
  const server = new McpServer({
    name: "literature-clock-mcp",
    title: "Literature Clock",
    version: VERSION,
    description: SERVER_DESCRIPTION,
    websiteUrl: HOME,
  }, {
    instructions: INSTRUCTIONS,
  });

  const headers = () => requestHeaders() || {};

  function gate(name) {
    return security.authorizeCall(name, headers());
  }

  function sourceIds(value) {
    const prefix = String(value || "").toLowerCase();
    return store.sourceCatalog().map((item) => item.id).filter((id) => id.startsWith(prefix)).slice(0, 20);
  }

  function minuteHints(value) {
    const raw = String(value || "");
    const seeds = ["now", "09-05", "12-00", "14-30", "18-00", "23-59"];
    return seeds.filter((item) => item.startsWith(raw)).slice(0, 20);
  }

  async function run(name, params, fn) {
    const allowed = gate(name);
    if (!allowed.ok) return denied(allowed);
    try {
      const data = await fn(allowed);
      security.recordSuccess(name, allowed.principal, redact(params));
      return json(data);
    } catch (error) {
      security.recordError(name, allowed.principal, redact(params), error.message);
      return fail(error.message, {
        next: error.code === "bad_source"
          ? "Call list_sources and pass one of those ids."
          : error.code === "bad_time"
            ? "Pass time as HH:MM, or omit it for the current minute."
            : error.code === "bad_schema"
              ? "Call list_schemas and pass one of those names to get_schema."
              : error.code === "bad_protocol"
                ? "Leave at least one of stdio, Streamable HTTP, and SSE turned on."
                : error.code === "bad_push"
                  ? "Use 0, 5, 10, 15, 30, or 60 minutes, and turn on a destination."
                  : error.code === "bad_mqtt"
                    ? "Check the MQTT URL, topic, and broker. The password is not returned by get_settings."
                    : error.code === "bad_import"
                  ? "Pass the object from export_settings. kind must be literature-clock-settings and version 1."
                  : error.code === "bad_user"
                    ? "Check the username, password, and scopes. The built-in admin name is not replaced here."
                    : error.code === "bad_key"
                      ? "Pass an id from list_api_keys."
                      : "Call describe_server, then retry once with corrected arguments.",
      });
    }
  }

  server.registerTool(
    "describe_server",
    {
      title: "Describe this server",
      description: TOOL_CATALOG[0][2],
      inputSchema: {},
      outputSchema: OUT.describe_server,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("describe_server", {}, (allowed) => {
      const principal = allowed.principal || { type: "anonymous", label: "anonymous", scopes: [], grantedScopes: [] };
      const snap = security.snapshot();
      const authenticated = principal.type !== "anonymous" && principal.type !== "invalid";
      return {
        ok: true,
        server: {
          name: "literature-clock-mcp",
          title: "Literature Clock",
          version: VERSION,
          description: SERVER_DESCRIPTION,
          tool_count: TOOL_COUNT,
          homepage: HOME,
        },
        author: {
          name: AUTHOR.name,
          url: AUTHOR.url,
          github: AUTHOR.github,
          tagline: AUTHOR.tagline,
        },
        you: {
          principal: principal.label || "anonymous",
          type: principal.type || "anonymous",
          authenticated,
          scopes: principal.grantedScopes || [],
          effective_scopes: principal.scopes || [],
          problem: principal.type === "invalid" ? (principal.error || "credential rejected") : "",
        },
        auth: {
          mode: snap.authMode,
          modes: snap.authModes,
          meaning: meaning(snap.authMode),
          accepted: "Authorization: Bearer <api key>, or MCP_API_KEY over stdio",
          active_api_keys: snap.activeKeyCount,
        },
        rate_limit: security.rateSnapshot(principal.id || "anonymous"),
        tools: TOOL_CATALOG.map(([name, scope, purpose]) => ({
          name,
          required_scope: scope,
          credential_required_now: security.authRequiredFor(name),
          available: snap.toolGates[name] !== false,
          purpose,
        })),
        resources: [
          { uri: "sources://list", description: "Every quote source" },
          { uri: "quote://{source}/{hhmm}", description: "One line. hhmm is HH-MM or now" },
        ],
        prompts: PROMPTS,
        clock: clockPrefs.snapshot(),
        protocols: snap.protocols,
        ui: { requireAuth: Boolean(snap.uiRequireAuth) },
        push: outlet.snapshot(),
        next: nextFor(snap.authMode, authenticated),
      };
    }),
  );

  server.registerTool(
    "list_sources",
    {
      title: "List quote sources",
      description: TOOL_CATALOG[1][2],
      inputSchema: {},
      outputSchema: OUT.list_sources,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("list_sources", {}, () => ({
      ok: true,
      sources: store.sourceCatalog(),
      next: `Call get_quote. Omit source to use the saved default (${clockPrefs.snapshot().defaultSource}).`,
    })),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Quote for a minute",
      description: TOOL_CATALOG[2][2],
      inputSchema: INPUT.get_quote,
      outputSchema: OUT.get_quote,
      annotations: { ...CLOSED, idempotentHint: false },
    },
    async (args) => run("get_quote", args || {}, async () => {
      const clock = clockPrefs.snapshot();
      return store.quotePayload({
        ...(args || {}),
        source: args?.source || clock.defaultSource,
        count: args?.count || clock.defaultCount,
        now: clockPrefs.zonedNow(),
      });
    }),
  );

  server.registerTool(
    "count_lines",
    {
      title: "Count lines for a minute",
      description: TOOL_CATALOG[3][2],
      inputSchema: INPUT.count_lines,
      outputSchema: OUT.count_lines,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async (args) => run("count_lines", args || {}, () => {
      const stamp = store.stampOf(args?.time, clockPrefs.zonedNow());
      const counts = store.countLines(stamp);
      const withLines = counts.voices.filter((item) => item.count > 0).map((item) => item.id);
      return {
        ok: true,
        ...counts,
        next: withLines.length
          ? `Call get_quote. Voices with a line: ${withLines.join(", ")}.`
          : "Call get_quote with source literature or books. No original voice has this exact minute.",
      };
    }),
  );

  server.registerTool(
    "get_settings",
    {
      title: "Read settings",
      description: TOOL_CATALOG[4][2],
      inputSchema: {},
      outputSchema: OUT.settings,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async (args) => run("get_settings", {}, () => ({
      ...settingsPayload(security, clockPrefs, outlet),
      next: CHAIN.get_settings,
    })),
  );

  server.registerTool(
    "update_settings",
    {
      title: "Update settings",
      description: TOOL_CATALOG[5][2],
      inputSchema: INPUT.update_settings,
      outputSchema: OUT.settings,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => run("update_settings", args || {}, () => ({
      ...applySettings({
        security,
        prefs: clockPrefs,
        push: outlet,
        patch: args || {},
        onToolsChanged,
      }),
      next: CHAIN.update_settings,
    })),
  );

  server.registerTool(
    "list_schemas",
    {
      title: "List schemas",
      description: TOOL_CATALOG[6][2],
      inputSchema: {},
      outputSchema: OUT.list_schemas,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("list_schemas", {}, () => ({
      ok: true,
      schemas: listSchemas(),
      next: "Call get_schema with one name. quote, source, and settings describe data. A tool name returns that tool's inputSchema and outputSchema.",
    })),
  );

  server.registerTool(
    "get_schema",
    {
      title: "Get a schema",
      description: TOOL_CATALOG[7][2],
      inputSchema: INPUT.get_schema,
      outputSchema: OUT.get_schema,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async (args) => run("get_schema", args || {}, () => readSchema(args?.name)),
  );

  server.registerTool(
    "push_quote",
    {
      title: "Push the current quote",
      description: TOOL_CATALOG[8][2],
      inputSchema: {},
      outputSchema: z.object({
        ok: z.boolean(),
        at: z.string(),
        time: z.string(),
        requested_source: z.string(),
        requested_label: z.string(),
        lines: z.array(Line),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => run("push_quote", {}, async () => {
      if (!outlet.snapshot().clientPush) {
        const error = new Error("Client push is off. Turn it on under Settings → Push, or call update_settings with clientPush true.");
        error.code = "bad_push";
        throw error;
      }
      if (typeof pushNow !== "function") {
        const error = new Error("This process has no event stream. Start the HTTP server, then call push_quote there.");
        error.code = "bad_push";
        throw error;
      }
      return pushNow({ ensureEvents: true });
    }),
  );

  const adminNote = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  function reject(message, code) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  server.registerTool(
    "list_users",
    {
      title: "List users",
      description: TOOL_CATALOG[9][2],
      inputSchema: {},
      outputSchema: OUT.list_users,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("list_users", {}, () => ({
      ok: true,
      users: security.snapshot().users,
      next: CHAIN.list_users,
    })),
  );

  server.registerTool(
    "create_user",
    {
      title: "Create a user",
      description: TOOL_CATALOG[10][2],
      inputSchema: INPUT.create_user,
      outputSchema: OUT.create_user,
      annotations: adminNote,
    },
    async (args) => run("create_user", args || {}, () => {
      const result = security.addUser(args?.username, args?.password, args?.scopes);
      if (!result.ok) reject(result.error, "bad_user");
      return { ok: true, username: result.username, next: CHAIN.create_user };
    }),
  );

  server.registerTool(
    "delete_user",
    {
      title: "Delete a user",
      description: TOOL_CATALOG[11][2],
      inputSchema: INPUT.delete_user,
      outputSchema: OUT.delete_user,
      annotations: { ...adminNote, destructiveHint: true },
    },
    async (args) => run("delete_user", args || {}, () => {
      const result = security.deleteUser(args?.username);
      if (!result.ok) reject(result.error, "bad_user");
      return { ok: true, next: CHAIN.delete_user };
    }),
  );

  server.registerTool(
    "list_api_keys",
    {
      title: "List API keys",
      description: TOOL_CATALOG[12][2],
      inputSchema: {},
      outputSchema: OUT.list_api_keys,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("list_api_keys", {}, () => ({
      ok: true,
      keys: security.listKeys().map((key) => ({
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        scopes: key.scopes,
        active: key.active,
      })),
      next: CHAIN.list_api_keys,
    })),
  );

  server.registerTool(
    "issue_api_key",
    {
      title: "Issue an API key",
      description: TOOL_CATALOG[13][2],
      inputSchema: INPUT.issue_api_key,
      outputSchema: OUT.issue_api_key,
      annotations: adminNote,
    },
    async (args) => run("issue_api_key", args || {}, (allowed) => {
      const issued = security.issueKey({
        label: args?.label,
        scopes: args?.scopes,
        expiresInDays: args?.expiresInDays,
        createdBy: allowed.principal?.label || "admin",
      });
      return {
        ok: true,
        key: issued.key,
        id: issued.record.id,
        prefix: issued.record.prefix,
        scopes: issued.record.scopes,
        next: CHAIN.issue_api_key,
      };
    }),
  );

  server.registerTool(
    "revoke_api_key",
    {
      title: "Revoke an API key",
      description: TOOL_CATALOG[14][2],
      inputSchema: INPUT.revoke_api_key,
      outputSchema: OUT.revoke_api_key,
      annotations: { ...adminNote, destructiveHint: true },
    },
    async (args) => run("revoke_api_key", args || {}, () => {
      const id = String(args?.id || "");
      if (!security.revokeKey(id)) reject("No such API key.", "bad_key");
      return { ok: true, id, next: CHAIN.revoke_api_key };
    }),
  );

  server.registerTool(
    "export_settings",
    {
      title: "Export settings",
      description: TOOL_CATALOG[15][2],
      inputSchema: {},
      outputSchema: OUT.export_settings,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("export_settings", {}, () => ({
      ok: true,
      version: VERSION,
      document: settingsDocument(security, clockPrefs, outlet),
      next: CHAIN.export_settings,
    })),
  );

  server.registerTool(
    "import_settings",
    {
      title: "Import settings",
      description: TOOL_CATALOG[16][2],
      inputSchema: INPUT.import_settings,
      outputSchema: OUT.import_settings,
      annotations: { ...adminNote, destructiveHint: true, idempotentHint: true },
    },
    async (args) => run("import_settings", args || {}, () => {
      const raw = args?.document;
      const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
      if (!String(text).trim()) reject("Paste a settings file, or pass the export object.", "bad_import");
      if (text.length > 200000) reject("That file is too large.", "bad_import");
      let doc;
      try {
        doc = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        reject("That file is not JSON.", "bad_import");
      }
      importSettingsDocument(doc, {
        security,
        prefs: clockPrefs,
        push: outlet,
        onToolsChanged,
      });
      return { ok: true, version: VERSION, next: CHAIN.import_settings };
    }),
  );

  server.registerTool(
    "export_log",
    {
      title: "Export the log",
      description: TOOL_CATALOG[17][2],
      inputSchema: {},
      outputSchema: OUT.export_log,
      annotations: { ...CLOSED, idempotentHint: true },
    },
    async () => run("export_log", {}, () => ({
      ok: true,
      version: VERSION,
      document: security.exportLog(),
      next: CHAIN.export_log,
    })),
  );

  server.registerTool(
    "push_quote_now",
    {
      title: "Push a quote now",
      description: TOOL_CATALOG[18][2],
      inputSchema: {},
      outputSchema: OUT.push_quote_now,
      annotations: { ...adminNote, idempotentHint: true },
    },
    async () => run("push_quote_now", {}, async () => {
      if (typeof pushNow !== "function") {
        reject("This process has no event stream. Start the HTTP server, then call push_quote_now there.", "bad_push");
      }
      const payload = await pushNow();
      return { ...payload, next: CHAIN.push_quote_now };
    }),
  );

  server.registerTool(
    "generate_traffic",
    {
      title: "Generate traffic",
      description: TOOL_CATALOG[19][2],
      inputSchema: INPUT.generate_traffic,
      outputSchema: OUT.generate_traffic,
      annotations: { ...adminNote, idempotentHint: false },
    },
    async (args) => run("generate_traffic", args || {}, async () => ({
      ...await generateTraffic({ store, security, rounds: args?.rounds }),
      next: CHAIN.generate_traffic,
    })),
  );

  const formTitles = {
    set_clock: "Save the clock",
    set_auth_mode: "Set auth mode",
    set_audit: "Set the call trace",
    set_rate_limit: "Set the rate limit",
    set_protocols: "Save protocols",
    set_ui_auth: "Hide pages until sign-in",
    set_tool_gate: "Enable or disable a tool",
    set_tool_lock: "Lock or unlock a tool",
    set_push: "Save the quote schedule",
  };
  const formPatch = {
    set_clock: (args) => args,
    set_auth_mode: (args) => ({ authMode: args.authMode }),
    set_audit: (args) => ({ auditMode: args.auditMode }),
    set_rate_limit: (args) => ({
      rateLimitEnabled: args.enabled,
      rateLimit: args.limit,
      rateLimitWindowSec: args.windowSeconds,
    }),
    set_protocols: (args) => ({
      stdioEnabled: args.stdio,
      streamableHttpEnabled: args.streamableHttp,
      sseEnabled: args.sse,
    }),
    set_ui_auth: (args) => ({ uiRequireAuth: args.enabled }),
    set_tool_gate: (args) => ({ tool: args.tool, toolEnabled: args.enabled }),
    set_tool_lock: (args) => ({ tool: args.tool, toolRequireAuth: args.requireAuth }),
    set_push: (args) => args,
  };
  for (const [name, toPatch] of Object.entries(formPatch)) {
    server.registerTool(
      name,
      {
        title: formTitles[name],
        description: TOOL_CATALOG.find((row) => row[0] === name)[2],
        inputSchema: INPUT[name],
        outputSchema: OUT.settings,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => run(name, args || {}, () => {
        if (name === "set_push" && args?.pushEveryMinutes && !args.pushEvents && !args.pushSse && !args.pushHttp && !args.mqttEnabled) {
          reject("Turn on a destination, or set the interval to 0.", "bad_push");
        }
        return {
          ...applySettings({
            security,
            prefs: clockPrefs,
            push: outlet,
            patch: toPatch(args || {}),
            onToolsChanged,
          }),
          next: CHAIN[name],
        };
      }),
    );
  }

  server.registerResource(
    "sources",
    "sources://list",
    {
      title: "Quote sources",
      description: "Books, mix, surprise, and every voice.",
      mimeType: "application/json",
    },
    async (uri) => {
      const allowed = gate("list_sources");
      if (!allowed.ok) return resourceDenied(allowed);
      return resourceJson(uri, { ok: true, sources: store.sourceCatalog() });
    },
  );

  server.registerResource(
    "quote",
    new ResourceTemplate("quote://{source}/{hhmm}", {
      list: async () => {
        const allowed = gate("list_sources");
        if (!allowed.ok) return { resources: [] };
        return {
          resources: store.sourceCatalog().map((item) => ({
            uri: `quote://${item.id}/now`,
            name: `${item.label} now`,
            description: item.note,
            mimeType: "application/json",
          })),
        };
      },
      complete: {
        source: (value) => sourceIds(value),
        hhmm: (value) => minuteHints(value),
      },
    }),
    {
      title: "Quote for a source and minute",
      description: "quote://pirate/14-30 or quote://books/now",
      mimeType: "application/json",
    },
    async (uri, { source, hhmm }) => {
      const allowed = gate("get_quote");
      if (!allowed.ok) return resourceDenied(allowed);
      try {
        return resourceJson(uri, await store.quotePayload({ time: hhmm, source, count: 1 }));
      } catch (error) {
        throw new McpError(ErrorCode.InvalidRequest, error.message);
      }
    },
  );

  const sourceArg = optionalCompletable(
    z.string().describe("literature, books, mix, surprise, or a voice id"),
    (value) => sourceIds(value),
  );
  const timeArg = optionalCompletable(
    z.string().describe("HH:MM or now"),
    (value) => minuteHints(value),
  );

  server.registerPrompt(
    "diagnose-server",
    {
      title: "Diagnose server",
      description: "Call describe_server and explain the auth mode, scopes, and available tools.",
    },
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Call describe_server. Tell me the auth mode, whether I am authenticated, which tools are available, and the single next call I should make.",
        },
      }],
    }),
  );

  server.registerPrompt(
    "quote-for-now",
    {
      title: "Quote for now",
      description: "Ask for the line that matches the current minute.",
      argsSchema: { source: sourceArg },
    },
    async ({ source }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Call get_quote with time "now"${source ? ` and source "${source}"` : ""}. Read the line in your reply and name the source. Do not invent a second line.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "another-line",
    {
      title: "Another line",
      description: "Ask for a different line at the same minute.",
      argsSchema: {
        time: z.string().describe("HH:MM"),
        source: sourceArg,
        avoid: z.string().describe("The line text to skip"),
      },
    },
    async ({ time, source, avoid }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Call get_quote for ${time}${source ? ` source ${source}` : ""} and pass avoid exactly as: ${avoid}`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "mix-the-minute",
    {
      title: "Mix the minute",
      description: "Draw several lines from books and every voice for one minute.",
      argsSchema: { time: timeArg },
    },
    async ({ time }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Call get_quote with source "mix", count 4, and time "${time || "now"}". Present each line with its source. Do not invent extra lines.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "voice-at-nine",
    {
      title: "Voice at nine",
      description: "Ask for the original voice line at 09:05.",
      argsSchema: { source: sourceArg },
    },
    async ({ source }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Call get_quote with time "09:05" and source "${source || "yoda"}". Quote the line and say it is an original voice, not a book.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "books-for-a-minute",
    {
      title: "Books for a minute",
      description: "Ask for the copyright-free book line at one minute.",
      argsSchema: { time: timeArg },
    },
    async ({ time }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Call get_quote with source "books" and time "${time || "now"}". Read the line and its citation. Do not invent a quotation.`,
        },
      }],
    }),
  );

  server.registerPrompt(
    "read-settings",
    {
      title: "Read settings",
      description: "Ask what the saved clock defaults are.",
    },
    async () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Call get_settings. Tell me the saved source, how many lines, the time zone, and the auth mode. Do not change anything.",
        },
      }],
    }),
  );

  return server;
}
