/** One settings document for the admin page, /api/settings, and the MCP tools. */
import { createPush } from "./push.js";
import { ALL_TOOLS, AUTH_MODES } from "./security.js";

const WRITE = new Set(["update_settings"]);

export function scopeOf(name) {
  return WRITE.has(name) ? "write" : "read";
}

function list(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function flag(value) {
  if (Array.isArray(value)) return flag(value.at(-1));
  if (value === false || value === 0 || value === "0" || value === "false" || value === "off") return false;
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function pushPatch(patch) {
  const keys = [
    "pushEveryMinutes",
    "pushEvents",
    "pushSse",
    "pushHttp",
    "mqttEnabled",
    "mqttUrl",
    "mqttTopic",
    "mqttUsername",
    "mqttPassword",
    "mqttClientId",
    "mqttClearPassword",
  ];
  if (!keys.some((key) => patch[key] !== undefined)) return null;
  const next = {};
  if (patch.pushEveryMinutes !== undefined) {
    const raw = Array.isArray(patch.pushEveryMinutes) ? patch.pushEveryMinutes.at(-1) : patch.pushEveryMinutes;
    next.pushEveryMinutes = Number(raw);
  }
  if (patch.pushEvents !== undefined) next.pushEvents = flag(patch.pushEvents);
  if (patch.pushSse !== undefined) next.pushSse = flag(patch.pushSse);
  if (patch.pushHttp !== undefined) next.pushHttp = flag(patch.pushHttp);
  if (patch.mqttEnabled !== undefined) next.mqttEnabled = flag(patch.mqttEnabled);
  if (patch.mqttUrl !== undefined) next.mqttUrl = patch.mqttUrl;
  if (patch.mqttTopic !== undefined) next.mqttTopic = patch.mqttTopic;
  if (patch.mqttUsername !== undefined) next.mqttUsername = patch.mqttUsername;
  if (patch.mqttPassword !== undefined) next.mqttPassword = String(patch.mqttPassword);
  if (patch.mqttClientId !== undefined) next.mqttClientId = patch.mqttClientId;
  if (patch.mqttClearPassword !== undefined) next.mqttClearPassword = flag(patch.mqttClearPassword);
  return next;
}

export function settingsPayload(security, prefs, push) {
  const snap = security.snapshot();
  const outlet = push || createPush();
  return {
    ok: true,
    clock: prefs.snapshot(),
    authMode: snap.authMode,
    authModes: snap.authModes,
    rateLimit: {
      enabled: Boolean(snap.rateLimit.enabled),
      limit: snap.rateLimit.limit,
      windowMs: snap.rateLimit.windowMs,
    },
    auditMode: Boolean(snap.auditMode),
    protocols: {
      stdio: snap.protocols?.stdio !== false,
      streamableHttp: snap.protocols?.streamableHttp !== false,
      sse: snap.protocols?.sse !== false,
    },
    uiRequireAuth: Boolean(snap.uiRequireAuth),
    push: outlet.snapshot(),
    tools: ALL_TOOLS.map((name) => ({
      name,
      scope: scopeOf(name),
      enabled: snap.toolGates[name] !== false,
      requireAuth: snap.toolAuthOverrides[name] === true,
    })),
    activeApiKeys: snap.activeKeyCount,
    next: "Change these with update_settings, POST /api/settings, or the /admin page. describe_server stays open.",
  };
}

export function applySettings({ security, prefs, push, patch = {}, onToolsChanged } = {}) {
  const structural = patch.authMode !== undefined || patch.tool !== undefined || patch.enabledTools !== undefined || patch.lockedTools !== undefined || patch.toolRequireAuth !== undefined;
  if (patch.defaultSource !== undefined || patch.defaultCount !== undefined || patch.timeZone !== undefined || patch.hourClock !== undefined) {
    prefs.update(patch);
  }
  if (patch.authMode !== undefined) {
    const mode = String(patch.authMode).toLowerCase();
    if (!AUTH_MODES.includes(mode)) {
      const error = new Error(`authMode must be ${AUTH_MODES.join(", ")}.`);
      error.code = "bad_auth";
      throw error;
    }
    security.setAuthMode(mode);
  }
  if (patch.rateLimitEnabled !== undefined || patch.rateLimit !== undefined || patch.rateLimitWindowSec !== undefined) {
    security.setRateLimit({
      enabled: patch.rateLimitEnabled,
      limit: patch.rateLimit,
      windowMs: patch.rateLimitWindowSec !== undefined ? Number(patch.rateLimitWindowSec) * 1000 : undefined,
    });
  }
  if (patch.auditMode !== undefined) security.setAuditMode(patch.auditMode);
  if (patch.stdioEnabled !== undefined || patch.streamableHttpEnabled !== undefined || patch.sseEnabled !== undefined) {
    security.setProtocols({
      stdio: patch.stdioEnabled,
      streamableHttp: patch.streamableHttpEnabled,
      sse: patch.sseEnabled,
    });
  }
  if (patch.uiRequireAuth !== undefined) security.setUiRequireAuth(patch.uiRequireAuth);
  const schedule = pushPatch(patch);
  if (schedule) {
    if (!push) {
      const error = new Error("The quote schedule is not available in this process.");
      error.code = "bad_push";
      throw error;
    }
    push.update(schedule);
  }
  if (patch.tool) {
    if (patch.tool === "describe_server" && patch.toolEnabled === false) {
      const error = new Error("describe_server stays available so a denied caller can still ask what to do next.");
      error.code = "protected_tool";
      throw error;
    }
    if (patch.toolEnabled !== undefined) security.setToolGate(patch.tool, patch.toolEnabled);
    if (patch.toolRequireAuth !== undefined) {
      if (patch.tool === "describe_server" && patch.toolRequireAuth) {
        const error = new Error("describe_server stays open in every auth mode.");
        error.code = "protected_tool";
        throw error;
      }
      security.setToolAuth(patch.tool, patch.toolRequireAuth);
    }
  }
  if (Array.isArray(patch.enabledTools)) {
    const enabled = new Set(list(patch.enabledTools));
    enabled.add("describe_server");
    for (const name of ALL_TOOLS) security.setToolGate(name, enabled.has(name));
  }
  if (Array.isArray(patch.lockedTools)) {
    const locked = new Set(list(patch.lockedTools));
    locked.delete("describe_server");
    for (const name of ALL_TOOLS) security.setToolAuth(name, locked.has(name));
  }
  if (structural && typeof onToolsChanged === "function") onToolsChanged();
  return settingsPayload(security, prefs, push);
}
