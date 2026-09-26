import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { AUTHOR } from "./meta.js";
import { VERSION } from "./version.js";
import { createPush } from "./push.js";
import { applySettings, settingsPayload } from "./settings.js";
import { createPrefs } from "./prefs.js";
import { Line, Source, jsonSchema, listSchemas, publishSchema, readSchema } from "./schemas.js";

export const TOOL_CATALOG = [
  ["describe_server", "read", "Call first, and after any denial: auth mode, your scopes, rate limit, and every tool"],
  ["list_sources", "read", "Literature, Books, Mix all, Surprise me, and every original voice id"],
  ["get_quote", "read", "A line for one clock minute. Omit source to use the saved default. avoid skips a line you already have"],
  ["count_lines", "read", "How many local lines each source has for one minute. Does not fetch the online library"],
  ["get_settings", "read", "Read clock defaults, auth mode, rate limit, which tools are enabled, and the quote schedule"],
  ["update_settings", "write", "Change clock defaults, auth, rate limit, audit, protocols, the page lock, the quote schedule, MQTT, or one tool gate. Same values as Settings"],
  ["list_schemas", "read", "Names of the line, source, settings, and tool schemas. Call this before get_schema"],
  ["get_schema", "read", "JSON Schema for one name from list_schemas. A tool name returns that tool's inputSchema and outputSchema"],
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
You are connected to literature-clock-mcp, a literature clock.

Rules:
1. Call describe_server first, and again after any denial. It tells you the auth mode, your scopes, and every tool.
2. Time is HH:MM (24-hour) or "now". There is no date. source is literature, books, mix, surprise, or a voice id from list_sources.
3. An empty lines array means that minute has no row. Try literature, books, or mix. Do not invent a quotation and do not retry the same arguments.
4. Pass avoid set to the previous line text to get a different line for the same minute.
5. Follow the next field once. Do not retry a denied call in a loop.
6. Clock defaults (source, how many lines, time zone) live in get_settings. Change them with update_settings or the /admin page. Do not invent a source id.
7. Call list_schemas, then get_schema with one name, before guessing fields on a line, a source, or a tool.
8. A schedule can push the current quote on GET /events, on open SSE and Streamable HTTP sessions, and to an MQTT broker. It is off until Settings or update_settings turns it on. Do not wait for a push. Call get_quote.`;

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
      version: z.string(),
      tool_count: z.number(),
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
    name: z.string().describe("A name from list_schemas: quote, source, settings, or a tool name."),
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

for (const [name, scope, purpose] of TOOL_CATALOG) {
  const input = INPUT[name] || {};
  const output = OUT[name] || (name === "get_settings" || name === "update_settings" ? OUT.settings : null);
  if (!output) continue;
  publishToolSchema(
    name,
    name,
    purpose,
    input,
    output,
    scope === "write"
      ? `Call ${name} with arguments that match inputSchema. This tool can change saved settings.`
      : `Call ${name} with arguments that match inputSchema.`,
  );
}

function json(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
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
  if (mode === "all") return "Every tool except describe_server needs a credential.";
  if (mode === "write") return "update_settings needs a credential. Read tools stay open.";
  return "No credential needed. Default for local use.";
}

function nextFor(mode, authenticated) {
  if (mode === "all" && !authenticated) {
    return "Auth mode is all. Send Authorization: Bearer <api key> or set MCP_API_KEY, then call list_sources and get_quote.";
  }
  return "Call list_sources, then get_quote. Omit time for the current minute. Omit source to use the saved default.";
}

export function createMcpServer({ store, security, prefs, push, requestHeaders = () => ({}), onToolsChanged = () => {} }) {
  const clockPrefs = prefs || createPrefs();
  const outlet = push || createPush();
  const server = new McpServer({
    name: "literature-clock-mcp",
    version: VERSION,
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
      security.recordSuccess(name, allowed.principal, params);
      return json(data);
    } catch (error) {
      security.recordError(name, allowed.principal, params, error.message);
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
        server: { name: "literature-clock-mcp", version: VERSION, tool_count: TOOL_COUNT },
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
    async (args) => run("get_settings", {}, () => settingsPayload(security, clockPrefs, outlet)),
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
    async (args) => run("update_settings", args || {}, () => applySettings({
      security,
      prefs: clockPrefs,
      push: outlet,
      patch: args || {},
      onToolsChanged,
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
