/** HTTP: /health /test /log /admin plus SSE and Streamable HTTP. */
import { randomUUID } from "node:crypto";
import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, TOOL_CATALOG, TOOL_COUNT } from "./create-server.js";
import { adminPage, healthPage, helpPage, loginPage, logPage, testPage, toolResultPage, toolsPage } from "./dashboard.js";
import { AUTHOR, LITERATURE } from "./meta.js";
import { clockPage } from "./pages.js";
import { listSchemas, readSchema } from "./schemas.js";
import { createPush, publishQuote, quoteDue, zonedMinute } from "./push.js";
import { applySettings, importSettingsDocument, settingsDocument, settingsPayload } from "./settings.js";
import { generateTraffic } from "./traffic.js";
import { VERSION } from "./version.js";

const COOKIE = "mcp_admin";

function cookieOf(req) {
  const header = req.headers.cookie || "";
  const part = header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`));
  return part ? decodeURIComponent(part.slice(COOKIE.length + 1)) : "";
}

function cookieFlags(req) {
  const parts = ["HttpOnly", "SameSite=Lax", "Path=/"];
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  if (req.secure || proto === "https") parts.push("Secure");
  return parts.join("; ");
}

function hostName(req) {
  return String(req.headers.host || "").split(":")[0].toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isPublicDeploy() {
  return Boolean(process.env.CONTAINER || process.env.CODE_ENGINE_PROJECT || process.env.HOST === "0.0.0.0");
}

export function defaultAdminDisabled() {
  return isPublicDeploy() && !process.env.ADMIN_PASSWORD;
}

function extraCorsOrigins() {
  return String(process.env.CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function originAllowed(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (isLoopbackHost(url.hostname)) return true;
    const host = hostName(req);
    if (host && url.hostname === host) return true;
  } catch {
    return false;
  }
  return extraCorsOrigins().includes(origin);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (!origin || !originAllowed(req)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, x-api-key");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, mcp-protocol-version");
  res.setHeader("Vary", "Origin");
}

function wantsHtml(req) {
  if (req.query?.format === "json") return false;
  return String(req.headers.accept || "").includes("text/html");
}

function formList(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function formPatch(body = {}) {
  return {
    defaultSource: body.defaultSource,
    defaultCount: Number(body.defaultCount),
    timeZone: body.timeZone,
    authMode: body.authMode,
    rateLimitEnabled: body.rateLimitEnabled === "1" || body.rateLimitEnabled === "on" || body.rateLimitEnabled === true,
    rateLimit: Number(body.rateLimit),
    rateLimitWindowSec: Number(body.rateLimitWindowSec),
    auditMode: body.auditMode === "1" || body.auditMode === "on" || body.auditMode === true,
    enabledTools: formList(body.enabledTools),
    lockedTools: formList(body.lockedTools),
  };
}
function publicSecurity(security) {
  const full = security.snapshot();
  return {
    authMode: full.authMode,
    writeToolsLocked: full.writeToolsLocked,
    allToolsLocked: full.allToolsLocked,
    tenantRequired: full.tenantRequired,
    tenantPresent: full.tenantPresent,
    tokenConfigured: full.tokenConfigured,
    activeKeyCount: full.activeKeyCount,
    rateLimit: full.rateLimit,
    scopes: full.scopes,
    protocols: full.protocols,
    uiRequireAuth: Boolean(full.uiRequireAuth),
  };
}

export function healthBody(security, req) {
  const info = {
    ok: true,
    service: "literature-clock-mcp",
    version: VERSION,
    transport: "http",
    tools: TOOL_COUNT,
    hostname: req?.headers?.host || "local",
    port: Number(process.env.PORT || 8080),
    security: publicSecurity(security),
    endpoints: { health: "/health", test: "/test", admin: "/admin", log: "/log", tools: "/tools", events: "/events", sse: "/sse", mcp: "/mcp" },
    note: "/health proves the process is up. /test proves the quote tools work.",
  };
  if (req && isLoopbackHost(hostName(req))) info.cwd = process.cwd();
  return info;
}

export async function testBody(store, { write = false } = {}) {
  const steps = [];
  const push = (name, ok, detail) => steps.push({ name, ok, detail: String(detail ?? "") });
  try {
    const sources = store.sourceCatalog();
    push("list_sources", sources.some((item) => item.id === "literature"), `${sources.length} sources`);
    const yoda = await store.quotePayload({ time: "09:05", source: "yoda" });
    push("get_quote yoda 09:05", yoda.lines.length === 1 && yoda.lines[0].source === "yoda", yoda.lines[0]?.text || "missing");
    const mix = await store.quotePayload({ time: "14:30", source: "mix", count: 3 });
    push("get_quote mix 14:30", mix.lines.length >= 2, mix.lines.map((line) => line.source).join(", "));
    const literature = await store.quotePayload({ time: "09:05", source: "literature" });
    push(
      "get_quote literature 09:05",
      literature.lines.length === 1 && literature.lines[0].source === "literature",
      literature.lines[0]?.citation || "missing",
    );
    const names = listSchemas().map((item) => item.name);
    push("list_schemas", names.includes("quote") && names.includes("get_quote"), `${names.length} schemas`);
    const quoteSchema = readSchema("quote");
    push("get_schema quote", quoteSchema.schema?.properties?.text?.type === "string", "quote.text");
    if (write) push("write", true, "read-only corpus — no rows were changed");
  } catch (error) {
    push("unexpected", false, error.message);
  }
  return { ok: steps.every((step) => step.ok), writes: write, steps, at: new Date().toISOString() };
}

export async function startHttp({ store, security, prefs, push }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "256kb" }));

  const zone = () => prefs.snapshot();
  const outlet = push || createPush();
  const sseSessions = new Map();
  const mcpSessions = new Map();
  const eventClients = new Set();
  let freshKey = "";
  let lastTraffic = null;

  function broadcastToolListChanged() {
    for (const { server } of sseSessions.values()) {
      try { server.server?.sendToolListChanged(); } catch { /* closing */ }
    }
    for (const { server } of mcpSessions.values()) {
      try { server.server?.sendToolListChanged(); } catch { /* closing */ }
    }
  }

  function requestAuthed(req) {
    if (security.validSession(cookieOf(req))) return true;
    const principal = security.identify(req.headers || {});
    return Boolean(principal && principal.type !== "anonymous" && principal.type !== "invalid");
  }

  function requireAdmin(req, res, next) {
    if (security.validSession(cookieOf(req))) return next();
    if (wantsHtml(req)) {
      res.status(401).type("html").send(loginPage({ disabled: defaultAdminDisabled(), timeZone: zone() }));
      return;
    }
    res.status(401).json({ ok: false, error: "Admin sign-in required.", next: "POST /admin/login" });
  }

  function serverFor(requestHeaders, transport) {
    return createMcpServer({
      store,
      security,
      prefs,
      push: outlet,
      pushNow,
      requestHeaders: () => ({ ...(requestHeaders() || {}), "x-literature-clock-transport": transport }),
      onToolsChanged: broadcastToolListChanged,
    });
  }

  function safeNext(value) {
    const path = String(value || "");
    return path.startsWith("/") && !path.startsWith("//") ? path : "";
  }

  function touchLive() {
    outlet.setLive({
      events: eventClients.size,
      sse: sseSessions.size,
      streamableHttp: mcpSessions.size,
    });
  }

  function viewSettings() {
    touchLive();
    return settingsPayload(security, prefs, outlet);
  }

  function quoteStreamAllowed(req) {
    if (security.validSession(cookieOf(req))) return true;
    return security.authorizeCall("get_quote", req.headers || {}).ok;
  }

  async function deliver(payload, dest) {
    if (dest.events) {
      const frame = `event: quote\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const res of eventClients) {
        try { res.write(frame); } catch { eventClients.delete(res); }
      }
    }
    const note = { method: "notifications/literature-clock/quote", params: payload };
    if (dest.sse) {
      for (const session of sseSessions.values()) {
        try { await session.server.server.notification(note); } catch { /* session is closing */ }
      }
    }
    if (dest.streamableHttp) {
      for (const session of mcpSessions.values()) {
        try { await session.server.server.notification(note); } catch { /* no open GET stream */ }
      }
    }
  }

  async function pushNow(options = {}) {
    return publishQuote({ push: outlet, store, prefs, deliver, ensureEvents: Boolean(options.ensureEvents) });
  }

  let pushBusy = false;
  async function scheduledPush() {
    if (pushBusy) return;
    const face = zonedMinute(prefs.snapshot().timeZone);
    if (!quoteDue(outlet.snapshot().everyMinutes, face.minute, face.key, outlet.cursor())) return;
    pushBusy = true;
    try {
      await publishQuote({ push: outlet, store, prefs, deliver, scheduledKey: face.key });
    } catch {
      /* The schedule keeps the last error for Settings. */
    } finally {
      pushBusy = false;
    }
  }

  function protocolClosed(res, label) {
    res.status(503).json({
      ok: false,
      error: `${label} is turned off.`,
      next: "Turn it on under Settings → Protocols. At least one protocol stays on.",
    });
  }

  app.use((req, res, next) => {
    if (!security.snapshot().uiRequireAuth) return next();
    if (!wantsHtml(req)) return next();
    if (req.path === "/admin" || req.path.startsWith("/admin/")) return next();
    if (req.path === "/mcp" || req.path === "/sse" || req.path === "/messages" || req.path.startsWith("/api/")) return next();
    if (security.validSession(cookieOf(req))) return next();
    res.status(401).type("html").send(loginPage({
      error: "These pages stay hidden until you sign in.",
      next: req.originalUrl || "/",
      timeZone: zone(),
    }));
  });

  function randomSource(current) {
    const pool = store.sourceCatalog()
      .map((item) => item.id)
      .filter((id) => !["mix", "surprise"].includes(id) && id !== current);
    return pool[Math.floor(Math.random() * pool.length)] || "literature";
  }

  app.get("/", async (req, res) => {
    let source = String(req.query.source || prefs.snapshot().defaultSource);
    const time = String(req.query.time || "now");
    const randomized = req.query.random === "1" || source === "random";
    if (randomized) source = randomSource(source === "random" ? "" : source);
    if (randomized && wantsHtml(req)) {
      const query = new URLSearchParams({ source, time });
      res.redirect(`/?${query.toString()}`);
      return;
    }
    let quote;
    try {
      quote = await store.quotePayload({
        source,
        time,
        avoid: req.query.another ? String(req.query.avoid || "") : "",
        count: 1,
        now: prefs.zonedNow(),
      });
    } catch (error) {
      quote = { ok: false, time, lines: [], error: error.message };
    }
    if (!wantsHtml(req)) {
      res.json({ name: "literature-clock-mcp", version: VERSION, quote, settings: prefs.snapshot() });
      return;
    }
    res.type("html").send(clockPage({
      quote,
      settings: viewSettings(),
      sources: store.sourceCatalog(),
      source,
      time: time === "now" ? quote.time : time,
    }));
  });

  app.get("/health", (req, res) => {
    const body = healthBody(security, req);
    if (!wantsHtml(req)) {
      res.json(body);
      return;
    }
    res.type("html").send(healthPage(body, zone()));
  });

  app.get("/test", async (req, res) => {
    const write = req.query.write === "1";
    if (write && !security.validSession(cookieOf(req))) {
      if (wantsHtml(req)) {
        res.status(401).type("html").send(loginPage({ error: "Write smoke requires a sign-in.", timeZone: zone() }));
        return;
      }
      res.status(401).json({ ok: false, error: "Admin sign-in required for /test?write=1." });
      return;
    }
    const body = await testBody(store, { write });
    if (!wantsHtml(req)) {
      res.status(body.ok ? 200 : 500).json(body);
      return;
    }
    res.status(body.ok ? 200 : 500).type("html").send(testPage(body, req.headers.host || "127.0.0.1:8788", lastTraffic, zone(), security.validSession(cookieOf(req))));
  });

  app.post("/test/traffic", async (req, res) => {
    if (!requestAuthed(req)) {
      if (wantsHtml(req)) {
        res.status(401).type("html").send(loginPage({
          error: "Sign in to generate traffic.",
          next: "/test#tab-traffic",
          timeZone: zone(),
        }));
        return;
      }
      res.status(401).json({
        ok: false,
        error: "Sign in or send an API key to generate traffic.",
        next: "POST /admin/login, or Authorization: Bearer <api key>",
      });
      return;
    }
    const rounds = Math.min(20, Math.max(1, Number(req.body?.rounds) || 5));
    const result = await generateTraffic({ store, security, rounds });
    lastTraffic = result;
    if (!wantsHtml(req)) {
      res.json(result);
      return;
    }
    res.redirect(303, "/test#tab-traffic");
  });

  app.get("/tools/result", (req, res) => {
    res.type("html").send(toolResultPage());
  });

  app.get("/tools", (req, res) => {
    const tools = TOOL_CATALOG.map(([name, scope, purpose]) => ({ name, purpose, scope }));
    if (!wantsHtml(req)) {
      res.json({ ok: true, tools });
      return;
    }
    res.type("html").send(toolsPage(security.snapshot().authMode, zone()));
  });

  app.get("/help", (req, res) => {
    if (!wantsHtml(req)) {
      res.json({
        ok: true,
        author: AUTHOR,
        literature: LITERATURE,
        tools: TOOL_CATALOG.map(([name, scope, purpose]) => ({ name, purpose, scope })),
        pages: ["/", "/health", "/test", "/tools", "/help", "/admin", "/log", "/events"],
      });
      return;
    }
    res.type("html").send(helpPage(req.headers.host || "127.0.0.1:8788", zone()));
  });

  app.get("/log", requireAdmin, (req, res) => {
    const snap = security.snapshot();
    if (!wantsHtml(req)) {
      res.json({
        ok: true,
        toolCounters: snap.toolCounters,
        errorLog: snap.errorLog,
        callTrace: snap.callTrace,
        adminEvents: snap.adminEvents,
        auditMode: snap.auditMode,
        deniedCount: snap.deniedCount,
      });
      return;
    }
    res.type("html").send(logPage(snap, zone()));
  });

  app.get("/admin", (req, res) => {
    if (!security.validSession(cookieOf(req))) {
      if (wantsHtml(req)) {
        res.status(401).type("html").send(loginPage({ disabled: defaultAdminDisabled(), next: safeNext(req.query.next), timeZone: zone() }));
        return;
      }
      res.status(401).json({ ok: false, error: "Sign in with POST /admin/login.", defaultDisabled: defaultAdminDisabled() });
      return;
    }
    const payload = viewSettings();
    if (!wantsHtml(req)) {
      res.json({ ok: true, ...payload, security: security.snapshot() });
      return;
    }
    const key = freshKey;
    freshKey = "";
    res.type("html").send(adminPage({
      security: security.snapshot(),
      settings: payload,
      sources: store.sourceCatalog(),
      issuedKey: key,
      notice: String(req.query.notice || ""),
    }));
  });

  app.get("/api/settings", (_req, res) => {
    res.json(viewSettings());
  });

  app.post("/api/settings", (req, res) => {
    const allowed = security.authorizeCall("update_settings", req.headers);
    const admin = security.validSession(cookieOf(req));
    if (!admin && !allowed.ok) {
      res.status(allowed.status || 401).json({ ok: false, error: allowed.error, next: "Sign in at /admin or send a key with the write scope." });
      return;
    }
    try {
      const settings = applySettings({ security, prefs, push: outlet, patch: req.body || {}, onToolsChanged: broadcastToolListChanged });
      res.json(settings);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/settings", requireAdmin, (req, res) => {
    try {
      applySettings({
        security,
        prefs,
        push: outlet,
        patch: {
          defaultSource: req.body?.defaultSource,
          defaultCount: Number(req.body?.defaultCount),
          timeZone: req.body?.timeZone,
          hourClock: req.body?.hourClock,
        },
        onToolsChanged: broadcastToolListChanged,
      });
      if (wantsHtml(req)) {
        res.redirect("/admin#set-clock");
        return;
      }
      res.json(viewSettings());
    } catch (error) {
      if (wantsHtml(req)) {
        res.status(400).type("html").send(adminPage({
          security: security.snapshot(),
          settings: viewSettings(),
          sources: store.sourceCatalog(),
          notice: error.message,
        }));
        return;
      }
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  function htmlOrJson(req, res, hash, payload) {
    if (wantsHtml(req)) {
      res.redirect(`/admin${hash}`);
      return;
    }
    res.json(payload);
  }

  function flagOn(value) {
    const item = Array.isArray(value) ? value.at(-1) : value;
    return item === true || item === "1" || item === "true" || item === "on";
  }

  app.post("/admin/login", (req, res) => {
    if (defaultAdminDisabled()) {
      if (wantsHtml(req)) {
        res.status(403).type("html").send(loginPage({ error: "Set ADMIN_PASSWORD. The laptop default is disabled on a public bind.", disabled: true, timeZone: zone() }));
        return;
      }
      res.status(403).json({ ok: false, error: "Set ADMIN_PASSWORD. The laptop default is disabled on a public bind." });
      return;
    }
    const id = security.login(String(req.body?.username || ""), String(req.body?.password || ""));
    if (!id) {
      if (wantsHtml(req)) {
        res.status(401).type("html").send(loginPage({ error: "Wrong username or password.", timeZone: zone() }));
        return;
      }
      res.status(401).json({ ok: false, error: "Wrong username or password." });
      return;
    }
    res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(id)}; ${cookieFlags(req)}`);
    if (wantsHtml(req)) {
      res.redirect(safeNext(req.body?.next) || "/admin");
      return;
    }
    res.json({ ok: true });
  });

  function sendDownload(res, filename, body) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`${JSON.stringify(body, null, 2)}\n`);
  }

  app.get("/admin/export/settings", requireAdmin, (_req, res) => {
    sendDownload(res, "literature-clock-settings.json", settingsDocument(security, prefs, outlet));
  });

  app.get("/admin/export/log", requireAdmin, (_req, res) => {
    sendDownload(res, "literature-clock-log.json", security.exportLog());
  });

  app.post("/admin/import", requireAdmin, (req, res) => {
    try {
      const raw = String(req.body?.document || "");
      if (!raw.trim()) throw new Error("Paste a settings file, or choose one.");
      if (raw.length > 200000) throw new Error("That file is too large.");
      importSettingsDocument(JSON.parse(raw), {
        security,
        prefs,
        push: outlet,
        onToolsChanged: broadcastToolListChanged,
      });
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent("Settings imported.")}#set-backup`);
        return;
      }
      res.json(viewSettings());
    } catch (error) {
      const message = error instanceof SyntaxError ? "That file is not JSON." : error.message;
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(message)}#set-backup`);
        return;
      }
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post("/admin/logout", (req, res) => {
    security.logout(cookieOf(req));
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    if (wantsHtml(req)) {
      res.redirect("/");
      return;
    }
    res.json({ ok: true });
  });

  app.post("/admin/security", requireAdmin, (req, res) => {
    const snap = security.setAuthMode(req.body?.authMode || req.body?.mode);
    broadcastToolListChanged();
    htmlOrJson(req, res, "#set-security", { ok: true, security: snap });
  });

  app.post("/admin/rate-limit", requireAdmin, (req, res) => {
    const seconds = Number(req.body?.windowSeconds);
    const snap = security.setRateLimit({
      enabled: flagOn(req.body?.enabled),
      limit: req.body?.limit,
      windowMs: Number(req.body?.windowMs) || (seconds > 0 ? seconds * 1000 : undefined),
    });
    htmlOrJson(req, res, "#set-security", { ok: true, security: snap });
  });

  app.post("/admin/keys", requireAdmin, (req, res) => {
    const issued = security.issueKey({
      label: req.body?.label,
      scopes: req.body?.scopes || ["read"],
      expiresInDays: req.body?.expiresInDays,
      createdBy: "admin",
    });
    if (wantsHtml(req)) {
      freshKey = issued.key;
      res.redirect("/admin#set-keys");
      return;
    }
    res.status(201).json({ ok: true, ...issued });
  });

  app.post("/admin/users", requireAdmin, (req, res) => {
    const result = security.addUser(req.body?.username, req.body?.password, req.body?.scopes);
    const notice = result.ok ? `Saved ${result.username}.` : result.error;
    if (wantsHtml(req)) {
      res.redirect(`/admin?notice=${encodeURIComponent(notice)}#set-users`);
      return;
    }
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, error: result.ok ? "" : result.error, username: result.username || "" });
  });

  app.post("/admin/users/delete", requireAdmin, (req, res) => {
    const result = security.deleteUser(req.body?.username);
    const notice = result.ok ? "User removed." : result.error;
    if (wantsHtml(req)) {
      res.redirect(`/admin?notice=${encodeURIComponent(notice)}#set-users`);
      return;
    }
    res.status(result.ok ? 200 : 400).json({ ok: result.ok, error: result.ok ? "" : result.error });
  });

  app.post("/admin/keys/revoke", requireAdmin, (req, res) => {
    const ok = security.revokeKey(req.body?.id);
    if (wantsHtml(req)) {
      res.redirect("/admin#set-keys");
      return;
    }
    res.status(ok ? 200 : 404).json({ ok });
  });

  app.post("/admin/tool-gate", requireAdmin, (req, res) => {
    const snap = security.setToolGate(req.body?.tool || req.body?.name, flagOn(req.body?.enabled));
    broadcastToolListChanged();
    htmlOrJson(req, res, "#set-gates", { ok: true, security: snap });
  });

  app.post("/admin/tool-auth", requireAdmin, (req, res) => {
    const snap = security.setToolAuth(req.body?.tool || req.body?.name, flagOn(req.body?.requireAuth));
    broadcastToolListChanged();
    htmlOrJson(req, res, "#set-gates", { ok: true, security: snap });
  });

  app.post("/admin/protocols", requireAdmin, (req, res) => {
    try {
      const snap = security.setProtocols({
        stdio: flagOn(req.body?.stdio),
        streamableHttp: flagOn(req.body?.streamableHttp),
        sse: flagOn(req.body?.sse),
      });
      htmlOrJson(req, res, "#set-protocols", { ok: true, security: snap });
    } catch (error) {
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(error.message)}#set-protocols`);
        return;
      }
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/ui-auth", requireAdmin, (req, res) => {
    const snap = security.setUiRequireAuth(flagOn(req.body?.enabled));
    htmlOrJson(req, res, "#set-protocols", { ok: true, security: snap });
  });

  app.post("/admin/audit-mode", requireAdmin, (req, res) => {
    const snap = security.setAuditMode(flagOn(req.body?.enabled));
    htmlOrJson(req, res, "#set-security", { ok: true, security: snap });
  });

  app.post("/admin/push", requireAdmin, (req, res) => {
    try {
      applySettings({ security, prefs, push: outlet, patch: req.body || {} });
      const notice = "Saved the quote schedule.";
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(notice)}#set-push`);
        return;
      }
      res.json({ ok: true, ...viewSettings() });
    } catch (error) {
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(error.message)}#set-push`);
        return;
      }
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/admin/push-now", requireAdmin, async (req, res) => {
    try {
      const payload = await pushNow();
      const notice = payload.lines?.length ? `Sent ${payload.time}.` : `Sent ${payload.time}. That minute had no line.`;
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(notice)}#set-push`);
        return;
      }
      res.json({ ok: true, ...payload });
    } catch (error) {
      if (wantsHtml(req)) {
        res.redirect(`/admin?notice=${encodeURIComponent(error.message)}#set-push`);
        return;
      }
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/events", (req, res) => {
    applyCors(req, res);
    if (!originAllowed(req)) {
      res.status(403).json({ ok: false, error: "Origin not allowed." });
      return;
    }
    if (!quoteStreamAllowed(req)) {
      res.status(401).json({
        ok: false,
        error: "Sign in or send a credential. This stream follows the same rule as get_quote.",
        next: "POST /admin/login or Authorization: Bearer <key>",
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const snap = outlet.snapshot();
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, everyMinutes: snap.everyMinutes, events: snap.destinations.events })}\n\n`);
    eventClients.add(res);
    touchLive();
    req.on("close", () => {
      eventClients.delete(res);
      touchLive();
    });
  });

  app.get("/sse", async (req, res) => {
    if (!security.protocolOn("sse")) {
      protocolClosed(res, "Legacy SSE");
      return;
    }
    applyCors(req, res);
    if (!originAllowed(req)) {
      res.status(403).json({ ok: false, error: "Origin not allowed." });
      return;
    }
    const transport = new SSEServerTransport("/messages", res);
    const server = serverFor(() => req.headers, "sse");
    sseSessions.set(transport.sessionId, { transport, server });
    touchLive();
    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
      touchLive();
    });
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    if (!security.protocolOn("sse")) {
      protocolClosed(res, "Legacy SSE");
      return;
    }
    applyCors(req, res);
    const session = sseSessions.get(String(req.query.sessionId || ""));
    if (!session) {
      res.status(400).send("Unknown SSE session. Connect GET /sse first.");
      return;
    }
    await session.transport.handlePostMessage(req, res);
  });

  app.all("/mcp", async (req, res) => {
    if (!security.protocolOn("streamable-http")) {
      protocolClosed(res, "Streamable HTTP");
      return;
    }
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.status(originAllowed(req) ? 204 : 403).end();
      return;
    }
    if (!originAllowed(req)) {
      res.status(403).json({ ok: false, error: "Origin not allowed. Set CORS_ORIGINS or call from localhost." });
      return;
    }

    const sessionId = String(req.headers["mcp-session-id"] || "");
    if (sessionId && mcpSessions.has(sessionId)) {
      const session = mcpSessions.get(sessionId);
      session.setHeaders(req.headers);
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method === "POST" && isInitializeRequest(req.body)) {
      let latestHeaders = req.headers;
      let transport;
      const server = serverFor(() => latestHeaders, "streamable-http");
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          mcpSessions.set(id, { transport, server, setHeaders: (headers) => { latestHeaders = headers; } });
          touchLive();
        },
        onsessionclosed: (id) => {
          mcpSessions.delete(id);
          touchLive();
        },
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const server = serverFor(() => req.headers, "streamable-http");
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || (isPublicDeploy() ? "0.0.0.0" : "127.0.0.1");
  await new Promise((resolve) => {
    app.listen(port, host, () => {
      console.error(`literature-clock-mcp http on ${host}:${port}`);
      console.error("  /  /health  /test  /tools  /help  /admin  /log  /events  /sse  /mcp");
      setInterval(() => { void scheduledPush(); }, 10000);
      void scheduledPush();
      const snap = security.snapshot();
      console.error(`  auth mode=${snap.authMode}  rate limit=${snap.rateLimit.enabled ? `${snap.rateLimit.limit}/${Math.round(snap.rateLimit.windowMs / 1000)}s` : "off"}`);
      if (defaultAdminDisabled()) console.error("  admin login disabled until ADMIN_PASSWORD is set");
      resolve();
    });
  });
  return app;
}
