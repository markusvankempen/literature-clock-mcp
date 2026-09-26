/** One settings document for the admin page, /api/settings, and the MCP tools. */
import { createPush } from "./push.js";
import { ADMIN_TOOLS, ALL_TOOLS, AUTH_MODES, WRITE_TOOLS } from "./security.js";
import { VERSION } from "./version.js";

export function scopeOf(name) {
  if (ADMIN_TOOLS.has(name)) return "admin";
  if (WRITE_TOOLS.has(name)) return "write";
  return "read";
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
    "clientPush",
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
  if (patch.clientPush !== undefined) next.clientPush = flag(patch.clientPush);
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
    version: VERSION,
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
    next: "Change clock, auth, and push with update_settings. Users, API keys, backup, the log, and Push a quote now are admin tools. describe_server stays open.",
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

export function settingsDocument(security, prefs, push) {
  const payload = settingsPayload(security, prefs, push);
  const mqtt = payload.push?.mqtt || {};
  return {
    kind: "literature-clock-settings",
    version: 1,
    serverVersion: VERSION,
    exportedAt: new Date().toISOString(),
    clock: payload.clock,
    authMode: payload.authMode,
    rateLimit: payload.rateLimit,
    auditMode: payload.auditMode,
    protocols: payload.protocols,
    uiRequireAuth: payload.uiRequireAuth,
    push: {
      everyMinutes: payload.push?.everyMinutes ?? 0,
      clientPush: Boolean(payload.push?.clientPush),
      destinations: payload.push?.destinations || {},
      mqtt: {
        url: mqtt.url || "",
        topic: mqtt.topic || "",
        username: mqtt.username || "",
        clientId: mqtt.clientId || "",
      },
    },
    tools: (payload.tools || []).map((tool) => ({
      name: tool.name,
      enabled: tool.enabled !== false,
      requireAuth: tool.requireAuth === true,
    })),
    users: security.exportUsers(),
  };
}

export function importSettingsDocument(doc, { security, prefs, push, onToolsChanged } = {}) {
  if (!doc || doc.kind !== "literature-clock-settings" || Number(doc.version) !== 1) {
    const error = new Error("That file is not a Literature Clock settings export.");
    error.code = "bad_import";
    throw error;
  }
  const clock = doc.clock || {};
  const rate = doc.rateLimit || {};
  const protocols = doc.protocols || {};
  const patch = {
    defaultSource: clock.defaultSource,
    defaultCount: clock.defaultCount,
    timeZone: clock.timeZone,
    hourClock: clock.hourClock,
    authMode: doc.authMode,
    rateLimitEnabled: rate.enabled,
    rateLimit: rate.limit,
    rateLimitWindowSec: rate.windowMs !== undefined ? Number(rate.windowMs) / 1000 : undefined,
    auditMode: doc.auditMode,
    stdioEnabled: protocols.stdio,
    streamableHttpEnabled: protocols.streamableHttp,
    sseEnabled: protocols.sse,
    uiRequireAuth: doc.uiRequireAuth,
  };
  if (doc.push && typeof doc.push === "object") {
    const dest = doc.push.destinations || {};
    const mqtt = doc.push.mqtt || {};
    Object.assign(patch, {
      pushEveryMinutes: doc.push.everyMinutes,
      clientPush: doc.push.clientPush,
      pushEvents: dest.events,
      pushSse: dest.sse,
      pushHttp: dest.streamableHttp,
      mqttEnabled: dest.mqtt,
      mqttUrl: mqtt.url,
      mqttTopic: mqtt.topic,
      mqttUsername: mqtt.username,
      mqttClientId: mqtt.clientId,
    });
  }
  if (Array.isArray(doc.tools)) {
    patch.enabledTools = doc.tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name);
    patch.lockedTools = doc.tools.filter((tool) => tool.requireAuth === true).map((tool) => tool.name);
  }
  applySettings({
    security,
    prefs,
    push,
    onToolsChanged,
    patch,
  });
  if (Array.isArray(doc.users)) security.replaceSavedUsers(doc.users);
  return settingsPayload(security, prefs, push);
}
