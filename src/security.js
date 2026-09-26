/**
 * Auth, scopes, API keys, rate limiting, per-tool gating, and call telemetry.
 *
 * None of this is in the MCP spec. The spec says nothing about who is allowed to
 * call a tool, so every server invents it. This file is one opinionated answer:
 *
 *   authMode  off    anyone can call anything (boring laptop default)
 *             write  read tools are open; write and PII tools need a credential
 *             all    every tool call needs a credential
 *
 * Per-tool gating (independent of authMode):
 *   Each tool can be individually enabled or disabled via setToolGate(name, enabled).
 *   A disabled tool returns a clear "tool is not available" error.
 *   Terminology: "gated" = requires auth,  "disabled" = switched off entirely.
 *
 * Credentials are an API key (Authorization: Bearer / x-api-key) or a username and
 * password (HTTP Basic). Each one resolves to a principal with scopes, and every
 * call is rate limited per principal.
 *
 * stdio has no headers, so the same credentials are read from the environment
 * (MCP_API_KEY, or MCP_USERNAME + MCP_PASSWORD).
 *
 * Telemetry (in-memory, never persisted):
 *   toolCounters  — success / error / denied call counts per tool name
 *   errorLog      — ring buffer of the last 50 calls that failed param validation
 *   auditLog      — full trace when auditMode is enabled (toggle via admin)
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const WRITE_TOOLS = new Set(["update_settings"]);
export const PII_TOOLS = new Set();
/**
 * Discovery stays open in every mode. A client that cannot ask "what do you need
 * from me?" can only guess, and a guessing model retries in a loop.
 * These calls are still rate limited.
 */
export const OPEN_TOOLS = new Set(["describe_server"]);

export const AUTH_MODES = ["off", "write", "all"];
export const SCOPES = ["read", "write", "pii", "admin"];

/** All known tool names — mirrors TOOL_CATALOG in create-server.js. */
export const ALL_TOOLS = [
  "describe_server",
  "list_sources",
  "get_quote",
  "count_lines",
  "get_settings",
  "update_settings",
  "list_schemas",
  "get_schema",
];

const KEY_PREFIX = "mcpk";
/** admin implies everything; write implies read. */
const IMPLIED = { admin: ["read", "write", "pii", "admin"], write: ["read", "write"], pii: ["read", "pii"], read: ["read"] };

const now = () => new Date().toISOString();

const MAX_ERROR_LOG = 50;
const MAX_AUDIT_LOG = 200;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hashPassword(password) {
  return sha256(password);
}

function passwordMatches(hash, password) {
  if (!hash) return false;
  return safeEqual(hash, hashPassword(password));
}

function expandScopes(scopes) {
  const out = new Set();
  for (const scope of scopes || []) {
    for (const implied of IMPLIED[scope] || [scope]) out.add(implied);
  }
  return [...out];
}

function normalizeScopes(input, fallback = ["read"]) {
  const list = (Array.isArray(input) ? input : String(input || "").split(/[\s,]+/))
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => SCOPES.includes(s));
  return list.length ? [...new Set(list)] : fallback;
}

/** "alice:secret:read,write" — one user per comma-separated group. */
function parseUsers(raw) {
  const users = new Map();
  for (const chunk of String(raw || "").split(",")) {
    const part = chunk.trim();
    if (!part) continue;
    const [username, password, scopes] = part.split(":");
    if (!username || !password) continue;
    const name = username.trim().toLowerCase();
    users.set(name, {
      username: name,
      passwordHash: hashPassword(password),
      scopes: normalizeScopes(scopes, ["read", "write"]),
      source: "env",
    });
  }
  return users;
}

function initialAuthMode() {
  const raw = String(process.env.AUTH_MODE || "").trim().toLowerCase();
  if (AUTH_MODES.includes(raw)) return raw;
  // Back-compat with the original single lock switch.
  if (process.env.WRITE_TOOLS_LOCKED === "1") return "write";
  return "off";
}

export function createSecurity({ log, saved, onChange } = {}) {
  const auditFn = (entry) => {
    adminEvents.unshift({ at: now(), principal: "admin", ...entry });
    if (adminEvents.length > MAX_AUDIT_LOG) adminEvents.pop();
    if (typeof log === "function") log(entry);
  };

  const state = {
    authMode: initialAuthMode(),
    tenantId: process.env.TENANT_ID || "",
    demoToken: process.env.DEMO_TOKEN || "demo-token",
    adminUser: process.env.ADMIN_USER || "demo",
    adminPassword: process.env.ADMIN_PASSWORD || "demo",
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED !== "0",
      limit: Math.max(1, Number(process.env.RATE_LIMIT || 60)),
      windowMs: Math.max(1000, Number(process.env.RATE_LIMIT_WINDOW_MS || 60000)),
    },
    deniedCount: 0,
    lastDeniedAt: "",
    /** Full-trace audit mode — disabled by default, togglable from /admin. */
    auditMode: false,
    protocols: {
      stdio: process.env.PROTOCOL_STDIO !== "0",
      streamableHttp: process.env.PROTOCOL_HTTP !== "0",
      sse: process.env.PROTOCOL_SSE !== "0",
    },
    uiRequireAuth: process.env.UI_REQUIRE_AUTH === "1",
  };

  /**
   * Per-tool gate state.
   * true  = enabled  (normal, default)
   * false = disabled (returns a clear "unavailable" error regardless of auth)
   */
  const toolGates = new Map(ALL_TOOLS.map((name) => [name, true]));

  /**
   * Per-tool auth overrides.
   * true  = this tool requires a credential regardless of the global authMode
   * false = follows global authMode (default for all tools)
   */
  const toolAuthOverrides = new Map(ALL_TOOLS.map((name) => [name, false]));

  if (saved && !process.env.AUTH_MODE && AUTH_MODES.includes(saved.authMode)) state.authMode = saved.authMode;
  if (saved?.rateLimit && process.env.RATE_LIMIT === undefined && process.env.RATE_LIMIT_ENABLED === undefined) {
    if (saved.rateLimit.enabled !== undefined) state.rateLimit.enabled = Boolean(saved.rateLimit.enabled);
    if (Number(saved.rateLimit.limit) > 0) state.rateLimit.limit = Math.floor(Number(saved.rateLimit.limit));
    if (Number(saved.rateLimit.windowMs) >= 1000) state.rateLimit.windowMs = Math.floor(Number(saved.rateLimit.windowMs));
  }
  if (saved?.auditMode !== undefined) state.auditMode = Boolean(saved.auditMode);
  if (saved?.protocols) {
    if (process.env.PROTOCOL_STDIO === undefined && saved.protocols.stdio !== undefined) state.protocols.stdio = Boolean(saved.protocols.stdio);
    if (process.env.PROTOCOL_HTTP === undefined && saved.protocols.streamableHttp !== undefined) state.protocols.streamableHttp = Boolean(saved.protocols.streamableHttp);
    if (process.env.PROTOCOL_SSE === undefined && saved.protocols.sse !== undefined) state.protocols.sse = Boolean(saved.protocols.sse);
  }
  if (process.env.UI_REQUIRE_AUTH === undefined && saved?.uiRequireAuth !== undefined) state.uiRequireAuth = Boolean(saved.uiRequireAuth);
  if (saved?.toolGates) {
    for (const [name, enabled] of Object.entries(saved.toolGates)) {
      if (name !== "describe_server" && toolGates.has(name)) toolGates.set(name, Boolean(enabled));
    }
  }
  if (saved?.toolAuthOverrides) {
    for (const [name, locked] of Object.entries(saved.toolAuthOverrides)) {
      if (name !== "describe_server" && toolAuthOverrides.has(name)) toolAuthOverrides.set(name, Boolean(locked));
    }
  }

  function remember() {
    if (typeof onChange !== "function") return;
    onChange({
      authMode: state.authMode,
      rateLimit: { ...state.rateLimit },
      toolGates: Object.fromEntries(toolGates),
      toolAuthOverrides: Object.fromEntries(toolAuthOverrides),
      auditMode: state.auditMode,
      protocols: { ...state.protocols },
      uiRequireAuth: state.uiRequireAuth,
      users: [...users.values()]
        .filter((user) => user.source === "saved")
        .map((user) => ({ username: user.username, passwordHash: user.passwordHash, scopes: user.scopes })),
    });
  }

  function protocolEnabled(transport) {
    if (transport === "stdio") return state.protocols.stdio;
    if (transport === "streamable-http") return state.protocols.streamableHttp;
    if (transport === "sse") return state.protocols.sse;
    return true;
  }

  /**
   * Per-tool call counters: { success, error, denied }
   * "error" counts calls that reached the handler but produced a validation / logic error.
   * "denied" counts auth / rate-limit denials (never reached the handler).
   */
  const toolCounters = new Map(ALL_TOOLS.map((name) => [name, { success: 0, error: 0, denied: 0 }]));

  /** Ring buffer of bad-parameter / validation error events (last MAX_ERROR_LOG entries). */
  const errorLog = [];

  /** Full call trace when auditMode is on (last MAX_AUDIT_LOG entries). */
  const callTrace = [];
  const invocations = [];

  /** Admin events: logins, mode changes, keys, gates. */
  const adminEvents = [];

  /** id -> { id, label, prefix, hash, scopes, createdAt, expiresAt, revokedAt, lastUsedAt, calls } */
  const keys = new Map();
  const users = parseUsers(process.env.MCP_USERS);
  if (Array.isArray(saved?.users)) {
    for (const row of saved.users) {
      const name = String(row?.username || "").trim().toLowerCase();
      const passwordHash = String(row?.passwordHash || "");
      if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(name) || !/^[a-f0-9]{64}$/.test(passwordHash)) continue;
      if (users.get(name)?.source === "env") continue;
      users.set(name, {
        username: name,
        passwordHash,
        scopes: normalizeScopes(row.scopes, ["read"]),
        source: "saved",
      });
    }
  }
  const sessions = new Map();
  const buckets = new Map();

  users.set(state.adminUser.toLowerCase(), {
    username: state.adminUser.toLowerCase(),
    passwordHash: hashPassword(state.adminPassword),
    scopes: ["admin"],
    source: "admin",
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  function counterFor(toolName) {
    if (!toolCounters.has(toolName)) toolCounters.set(toolName, { success: 0, error: 0, denied: 0 });
    return toolCounters.get(toolName);
  }

  function pushErrorLog(entry) {
    errorLog.unshift({ at: now(), ...callerOf(entry.principalObject), ...entry });
    if (errorLog.length > MAX_ERROR_LOG) errorLog.pop();
  }

  function pushCallTrace(entry) {
    callTrace.unshift({ at: now(), ...callerOf(entry.principalObject), ...entry });
    if (callTrace.length > MAX_AUDIT_LOG) callTrace.pop();
  }

  function callerOf(principal) {
    const type = principal?.type || "anonymous";
    if (type === "apikey" || type === "token") return { caller: "apikey", callerName: principal.label || "api key" };
    if (type === "user") return { caller: "user", callerName: principal.label || "user" };
    return { caller: "anonymous", callerName: type === "invalid" ? (principal?.label || "rejected") : "anonymous" };
  }

  function noteInvocation(tool, principal, outcome) {
    invocations.unshift({ at: now(), tool, outcome, ...callerOf(principal) });
    if (invocations.length > MAX_AUDIT_LOG) invocations.pop();
  }

  // ── API key management ─────────────────────────────────────────────────────

  function issueKey({ label, scopes, expiresInDays, createdBy } = {}) {
    const id = randomBytes(4).toString("hex");
    const secret = randomBytes(24).toString("base64url");
    const key = `${KEY_PREFIX}_${id}_${secret}`;
    const record = {
      id,
      label: String(label || "unnamed key").slice(0, 60),
      prefix: `${KEY_PREFIX}_${id}`,
      hash: sha256(key),
      scopes: normalizeScopes(scopes, ["read"]),
      createdAt: now(),
      createdBy: createdBy || "admin",
      expiresAt: Number(expiresInDays) > 0
        ? new Date(Date.now() + Number(expiresInDays) * 86400000).toISOString()
        : "",
      revokedAt: "",
      lastUsedAt: "",
      calls: 0,
    };
    keys.set(id, record);
    auditFn({ tool: "admin.api_key", outcome: `issued ${record.prefix} (${record.scopes.join("+")})` });
    // The plaintext is returned once and never stored.
    return { key, record: publicKey(record) };
  }

  if (process.env.API_KEY) {
    // A key supplied by the environment cannot be hashed-on-issue, so register it directly.
    const id = "env00001";
    keys.set(id, {
      id,
      label: "API_KEY from environment",
      prefix: String(process.env.API_KEY).slice(0, 12),
      hash: sha256(process.env.API_KEY),
      scopes: normalizeScopes(process.env.API_KEY_SCOPES, ["read"]),
      createdAt: now(),
      createdBy: "env",
      expiresAt: "",
      revokedAt: "",
      lastUsedAt: "",
      calls: 0,
      fromEnv: true,
    });
  }

  function publicKey(record) {
    return {
      id: record.id,
      label: record.label,
      prefix: record.prefix,
      scopes: record.scopes,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      lastUsedAt: record.lastUsedAt,
      calls: record.calls,
      active: isActive(record),
      fromEnv: Boolean(record.fromEnv),
    };
  }

  function isActive(record) {
    if (!record || record.revokedAt) return false;
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return false;
    return true;
  }

  function findKey(presented) {
    const text = String(presented || "");
    if (!text) return null;
    const parts = text.split("_");
    const byId = parts.length >= 3 ? keys.get(parts[1]) : null;
    const candidates = byId ? [byId] : [...keys.values()];
    const hash = sha256(text);
    return candidates.find((record) => safeEqual(record.hash, hash)) || null;
  }

  // ── credential resolution ──────────────────────────────────────────────────

  /** Pull whatever credential the caller presented out of headers (or stdio env). */
  function readCredentials(headers = {}, extra = {}) {
    const get = (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
    const authorization = String(get("authorization") || "");
    const out = { apiKey: "", username: "", password: "" };

    if (/^Bearer\s+/i.test(authorization)) out.apiKey = authorization.replace(/^Bearer\s+/i, "").trim();
    if (/^Basic\s+/i.test(authorization)) {
      const decoded = Buffer.from(authorization.replace(/^Basic\s+/i, "").trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        out.username = decoded.slice(0, idx);
        out.password = decoded.slice(idx + 1);
      }
    }
    out.apiKey = out.apiKey || String(get("x-api-key") || get("x-demo-token") || extra.token || "");
    out.username = out.username || String(get("x-mcp-username") || "");
    out.password = out.password || String(get("x-mcp-password") || "");
    return out;
  }

  /** Resolve a credential to a principal. Anonymous is a valid principal with no scopes. */
  function identify(headers = {}, extra = {}) {
    const creds = readCredentials(headers, extra);

    if (creds.apiKey) {
      const record = findKey(creds.apiKey);
      if (!record) {
        return {
          type: "invalid",
          id: "invalid",
          label: "unknown API key",
          scopes: [],
          error: "That API key is not recognised. Create one on /admin → API keys, then send it as Authorization: Bearer <key>.",
        };
      }
      if (!isActive(record)) {
        return {
          type: "invalid",
          id: record.id,
          label: record.label,
          scopes: [],
          error: record.revokedAt
            ? `API key ${record.prefix} was revoked on ${record.revokedAt}. Issue a new one on /admin.`
            : `API key ${record.prefix} expired on ${record.expiresAt}. Issue a new one on /admin.`,
        };
      }
      record.lastUsedAt = now();
      record.calls += 1;
      return {
        type: "apikey",
        id: `key:${record.id}`,
        label: record.label,
        prefix: record.prefix,
        scopes: expandScopes(record.scopes),
        grantedScopes: record.scopes,
      };
    }

    if (creds.username) {
      const user = users.get(String(creds.username).trim().toLowerCase());
      if (!user || !passwordMatches(user.passwordHash, creds.password)) {
        return {
          type: "invalid",
          id: "invalid",
          label: creds.username,
          scopes: [],
          error: "Wrong username or password. Create one under Settings → Users, or use an API key.",
        };
      }
      return {
        type: "user",
        id: `user:${user.username}`,
        label: user.username,
        scopes: expandScopes(user.scopes),
        grantedScopes: user.scopes,
      };
    }

    // Legacy single-token switch, kept so older configs still work.
    if (state.demoToken && creds.apiKey && safeEqual(creds.apiKey, state.demoToken)) {
      return { type: "token", id: "token:demo", label: "DEMO_TOKEN", scopes: expandScopes(["write", "pii"]), grantedScopes: ["write", "pii"] };
    }

    return { type: "anonymous", id: "anonymous", label: "anonymous", scopes: [], grantedScopes: [] };
  }

  // ── scope / auth helpers ───────────────────────────────────────────────────

  function requiredScope(toolName) {
    if (WRITE_TOOLS.has(toolName)) return "write";
    if (PII_TOOLS.has(toolName)) return "pii";
    return "read";
  }

  /** Does this tool need a credential under the current mode or a per-tool override? */
  function authRequiredFor(toolName) {
    if (OPEN_TOOLS.has(toolName)) return false;
    if (toolAuthOverrides.get(toolName) === true) return true;
    if (state.authMode === "all") return true;
    if (state.authMode === "write") return WRITE_TOOLS.has(toolName) || PII_TOOLS.has(toolName);
    return false;
  }

  // ── rate limiting ──────────────────────────────────────────────────────────

  function rateSnapshot(principalId) {
    const { enabled, limit, windowMs } = state.rateLimit;
    if (!enabled) return { enabled: false, limit, windowMs, used: 0, remaining: limit, resetInMs: 0 };
    const bucket = buckets.get(principalId);
    const fresh = !bucket || bucket.resetAt <= Date.now();
    const used = fresh ? 0 : bucket.count;
    return {
      enabled: true,
      limit,
      windowMs,
      used,
      remaining: Math.max(0, limit - used),
      resetInMs: fresh ? windowMs : bucket.resetAt - Date.now(),
    };
  }

  function consumeRate(principalId) {
    const { enabled, limit, windowMs } = state.rateLimit;
    if (!enabled) return { ok: true };
    const existing = buckets.get(principalId);
    const bucket = !existing || existing.resetAt <= Date.now()
      ? { count: 0, resetAt: Date.now() + windowMs }
      : existing;
    bucket.count += 1;
    buckets.set(principalId, bucket);
    if (bucket.count > limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
      return {
        ok: false,
        retryAfterSec,
        error: `Rate limit reached: ${limit} calls per ${Math.round(windowMs / 1000)}s for ${principalId}. Wait ${retryAfterSec}s and try again, or raise the limit on /admin. Do not retry in a loop.`,
      };
    }
    return { ok: true, remaining: limit - bucket.count };
  }

  // ── deny helper ────────────────────────────────────────────────────────────

  function deny(principal, toolName, error, extra = {}) {
    state.deniedCount += 1;
    state.lastDeniedAt = now();
    counterFor(toolName).denied += 1;
    auditFn({ tool: toolName, principal: principal?.label || "anonymous", outcome: `denied — ${extra.reason || "unauthorized"}` });
    if (state.auditMode) {
      pushCallTrace({ type: "denied", tool: toolName, principal: principal?.label || "anonymous", reason: extra.reason || "unauthorized", error });
    }
    return { ok: false, principal, error, ...extra };
  }

  // ── public API ─────────────────────────────────────────────────────────────

  return {
    /** Everything the /health page, the admin page, and describe_server report. */
    snapshot() {
      return {
        authMode: state.authMode,
        authModes: AUTH_MODES,
        // Kept for older clients and pages that only knew about the write lock.
        writeToolsLocked: state.authMode !== "off",
        allToolsLocked: state.authMode === "all",
        tenantRequired: Boolean(state.tenantId),
        tenantPresent: Boolean(state.tenantId),
        tokenConfigured: Boolean(state.demoToken),
        apiKeys: [...keys.values()].map(publicKey),
        activeKeyCount: [...keys.values()].filter(isActive).length,
        users: [...users.values()].map((user) => ({ username: user.username, scopes: user.scopes, source: user.source || "env" })),
        rateLimit: { ...state.rateLimit },
        deniedCount: state.deniedCount,
        lastDeniedAt: state.lastDeniedAt,
        scopes: SCOPES,
        /** Per-tool gate state: name → enabled (true/false). */
        toolGates: Object.fromEntries(toolGates),
        /** Per-tool auth overrides: name → requireAuth (true/false). */
        toolAuthOverrides: Object.fromEntries(toolAuthOverrides),
        /** Per-tool counters: name → { success, error, denied }. */
        toolCounters: Object.fromEntries(toolCounters),
        auditMode: state.auditMode,
        protocols: { ...state.protocols },
        uiRequireAuth: state.uiRequireAuth,
        errorLog: errorLog.slice(0, 20),
        callTrace: callTrace.slice(0, 50),
        adminEvents: adminEvents.slice(0, 50),
      };
    },

    setAuthMode(mode) {
      const next = String(mode || "").toLowerCase();
      if (!AUTH_MODES.includes(next)) return this.snapshot();
      state.authMode = next;
      auditFn({ tool: "admin.security", outcome: `auth mode set to ${next}` });
      remember();
      return this.snapshot();
    },

    /** Back-compat: the old boolean lock maps onto write mode. */
    setLocked(locked) {
      return this.setAuthMode(locked ? "write" : "off");
    },

    setRateLimit({ enabled, limit, windowMs } = {}) {
      if (enabled !== undefined) state.rateLimit.enabled = Boolean(enabled);
      if (Number(limit) > 0) state.rateLimit.limit = Math.floor(Number(limit));
      if (Number(windowMs) >= 1000) state.rateLimit.windowMs = Math.floor(Number(windowMs));
      buckets.clear();
      auditFn({
        tool: "admin.security",
        outcome: `rate limit ${state.rateLimit.enabled ? `${state.rateLimit.limit}/${Math.round(state.rateLimit.windowMs / 1000)}s` : "disabled"}`,
      });
      remember();
      return this.snapshot();
    },

    /**
     * Enable or disable an individual tool.
     * A disabled tool is immediately unavailable to any caller regardless of auth mode.
     */
    setToolGate(toolName, enabled) {
      if (!toolGates.has(toolName)) return this.snapshot();
      const on = Boolean(enabled);
      toolGates.set(toolName, on);
      auditFn({ tool: "admin.tool_gate", outcome: `${toolName} ${on ? "enabled" : "disabled"}` });
      remember();
      return this.snapshot();
    },

    /**
     * Override auth requirement for a specific tool.
     * When true the tool requires a credential regardless of the global authMode.
     */
    setToolAuth(toolName, requireAuth) {
      if (!toolAuthOverrides.has(toolName)) return this.snapshot();
      const on = Boolean(requireAuth);
      toolAuthOverrides.set(toolName, on);
      auditFn({ tool: "admin.tool_auth", outcome: `${toolName} auth-lock ${on ? "on" : "off"}` });
      remember();
      return this.snapshot();
    },

    /** Toggle full call tracing. When on, every allowed and denied call is recorded. */
    setProtocols(patch = {}) {
      const next = { ...state.protocols };
      if (patch.stdio !== undefined) next.stdio = Boolean(patch.stdio);
      if (patch.streamableHttp !== undefined) next.streamableHttp = Boolean(patch.streamableHttp);
      if (patch.sse !== undefined) next.sse = Boolean(patch.sse);
      if (!next.stdio && !next.streamableHttp && !next.sse) {
        const error = new Error("Leave at least one protocol on: stdio, Streamable HTTP, or SSE.");
        error.code = "bad_protocol";
        throw error;
      }
      state.protocols = next;
      auditFn({ tool: "admin.protocols", outcome: `stdio ${next.stdio ? "on" : "off"}, streamable-http ${next.streamableHttp ? "on" : "off"}, sse ${next.sse ? "on" : "off"}` });
      remember();
      return this.snapshot();
    },

    setUiRequireAuth(enabled) {
      state.uiRequireAuth = Boolean(enabled);
      auditFn({ tool: "admin.ui", outcome: state.uiRequireAuth ? "pages hidden until sign-in" : "pages open" });
      remember();
      return this.snapshot();
    },

    protocolOn(transport) {
      return protocolEnabled(transport);
    },

    setAuditMode(enabled) {
      state.auditMode = Boolean(enabled);
      if (state.auditMode) callTrace.length = 0; // start fresh
      auditFn({ tool: "admin.audit", outcome: `audit mode ${state.auditMode ? "on" : "off"}` });
      remember();
      return this.snapshot();
    },

    addUser(username, password, scopes) {
      const u = String(username || "").trim().toLowerCase();
      const p = String(password ?? "");
      if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u)) {
        return { ok: false, error: "Username must be 2–32 letters, numbers, dots, or dashes." };
      }
      if (p.length < 4 || p.length > 128) {
        return { ok: false, error: "Password must be 4–128 characters." };
      }
      if (u === String(state.adminUser || "").toLowerCase()) {
        return { ok: false, error: "That name is the built-in admin. Change it with ADMIN_USER and ADMIN_PASSWORD." };
      }
      if (users.get(u)?.source === "env") {
        return { ok: false, error: "That name comes from MCP_USERS. Change it in the environment." };
      }
      const s = normalizeScopes(scopes, []);
      if (!s.length) return { ok: false, error: "Choose at least one of read, write, or admin." };
      users.set(u, { username: u, passwordHash: hashPassword(p), scopes: s, source: "saved" });
      auditFn({ tool: "admin.user", outcome: `saved user ${u} scopes=${s.join(",")}` });
      remember();
      return { ok: true, username: u };
    },

    deleteUser(username) {
      const u = String(username || "").trim().toLowerCase();
      const user = users.get(u);
      if (!user) return { ok: false, error: "No such user." };
      if (user.source !== "saved") return { ok: false, error: "That user is built in. It is not removed here." };
      users.delete(u);
      auditFn({ tool: "admin.user", outcome: `deleted user ${u}` });
      remember();
      return { ok: true };
    },

    issueKey,

    revokeKey(id) {
      const record = keys.get(String(id));
      if (!record) return false;
      record.revokedAt = now();
      auditFn({ tool: "admin.api_key", outcome: `revoked ${record.prefix}` });
      return true;
    },

    listKeys() {
      return [...keys.values()].map(publicKey);
    },

    identify,
    requiredScope,
    authRequiredFor,
    rateSnapshot,

    /**
     * Record a successful tool call result. Called by create-server.js after the
     * handler returns so the counter and trace include the outcome.
     */
    recordSuccess(toolName, principal, params) {
      counterFor(toolName).success += 1;
      if (state.auditMode) {
        pushCallTrace({
          type: "success",
          tool: toolName,
          principal: principal?.label || "anonymous",
          params: params || {},
        });
      }
    },

    /**
     * Record a tool call that reached the handler but produced a logic/validation error
     * (e.g. unknown ticket id, bad param value). Called by create-server.js.
     */
    recordError(toolName, principal, params, error) {
      counterFor(toolName).error += 1;
      pushErrorLog({
        tool: toolName,
        principal: principal?.label || "anonymous",
        params: params || {},
        error: String(error),
      });
      if (state.auditMode) {
        pushCallTrace({
          type: "error",
          tool: toolName,
          principal: principal?.label || "anonymous",
          params: params || {},
          error: String(error),
        });
      }
    },

    /**
     * The single gate every tool call goes through.
     * Returns { ok, principal, error } — the error text is written for a model to act on.
     */
    authorizeCall(toolName, headers = {}, extra = {}) {
      // Tool disabled check comes first — no auth information is needed.
      const transport = String(headers["x-literature-clock-transport"] || "");
      if (transport && !protocolEnabled(transport) && toolName !== "describe_server" && toolName !== "update_settings") {
        const principal = { type: "anonymous", id: "anonymous", label: "anonymous", scopes: [], grantedScopes: [] };
        const label = transport === "streamable-http" ? "Streamable HTTP" : transport === "sse" ? "SSE" : "stdio";
        return deny(
          principal,
          toolName,
          `${label} is turned off. describe_server and update_settings still answer on this protocol. Turn ${label} on under Settings → Protocols, or call update_settings.`,
          { status: 503, reason: "protocol disabled" },
        );
      }

      if (toolGates.get(toolName) === false) {
        const principal = { type: "anonymous", id: "anonymous", label: "anonymous", scopes: [], grantedScopes: [] };
        return deny(
          principal,
          toolName,
          `${toolName} is currently unavailable. An administrator has disabled this tool. Call describe_server to see which tools are available. Do not retry ${toolName} until it is enabled.`,
          { status: 503, reason: "tool disabled" },
        );
      }

      const principal = identify(headers, extra);

      // A bad credential is fatal everywhere except discovery, which has to be able
      // to tell the caller *why* the credential was rejected.
      if (principal.type === "invalid" && !OPEN_TOOLS.has(toolName)) {
        return deny(principal, toolName, principal.error, { status: 401, reason: "bad credential" });
      }

      const tenant = this.checkTenant(headers);
      if (!tenant.ok && !OPEN_TOOLS.has(toolName) && (WRITE_TOOLS.has(toolName) || state.authMode === "all")) {
        return deny(principal, toolName, tenant.error, { status: 403, reason: "tenant header missing" });
      }

      const needed = requiredScope(toolName);
      if (authRequiredFor(toolName)) {
        if (principal.type === "anonymous") {
          return deny(
            principal,
            toolName,
            `${toolName} requires authentication because auth mode is "${state.authMode}". Send Authorization: Bearer <api key> (create one on /admin → API keys) or HTTP Basic with a username and password. Over stdio set MCP_API_KEY in the server env. Call describe_server if you are unsure which tools need a credential.`,
            { status: 401, reason: "anonymous" },
          );
        }
        if (!principal.scopes.includes(needed)) {
          return deny(
            principal,
            toolName,
            `${principal.label} has scopes [${principal.grantedScopes.join(", ") || "none"}] but ${toolName} requires the "${needed}" scope. Issue a key with that scope on /admin → API keys, then retry ${toolName} once. Call describe_server to see the scopes you currently hold.`,
            { status: 403, reason: `missing scope ${needed}` },
          );
        }
      }

      const rate = consumeRate(principal.id);
      if (!rate.ok) {
        return deny(principal, toolName, rate.error, { status: 429, reason: "rate limited", retryAfterSec: rate.retryAfterSec });
      }

      return {
        ok: true,
        principal,
        authenticated: principal.type !== "anonymous",
        scope: needed,
        remaining: rate.remaining,
      };
    },

    checkTenant(headers = {}) {
      if (!state.tenantId) return { ok: true };
      const got = headers["x-tenant-id"] || headers["X-Tenant-Id"];
      if (got === state.tenantId) return { ok: true };
      return {
        ok: false,
        error: "Auth looks fine, but every write will fail. Send header x-tenant-id with the tenant from /admin. This is the silent-failure row from the talk.",
      };
    },

    extractToken(headers = {}, extra = {}) {
      return readCredentials(headers, extra).apiKey;
    },

    /** Admin browser session for /admin — separate from MCP tool credentials. */
    login(username, password) {
      const name = String(username || "").trim().toLowerCase();
      const user = users.get(name);
      if (user && passwordMatches(user.passwordHash, password) && user.scopes.includes("admin")) {
        const id = `ses_${randomBytes(12).toString("hex")}`;
        sessions.set(id, Date.now());
        auditFn({ tool: "admin.login", outcome: `${username} signed in` });
        return id;
      }
      auditFn({ tool: "admin.login", outcome: `failed sign-in for ${username || "(blank)"}` });
      return null;
    },

    validSession(id) {
      return Boolean(id && sessions.has(id));
    },

    logout(id) {
      sessions.delete(id);
    },

    adminUser() {
      return state.adminUser;
    },
  };
}
