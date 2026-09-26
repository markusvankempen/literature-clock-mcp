/** Optional quote schedule. Off until an interval and a destination are saved. */
import net from "node:net";
import tls from "node:tls";

export const PUSH_INTERVALS = [5, 10, 15, 30, 60];

const DEFAULT_MQTT = {
  enabled: false,
  url: "mqtt://127.0.0.1:1883",
  topic: "literature-clock/quote",
  username: "",
  password: "",
  clientId: "literature-clock",
};

function bad(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function zonedMinute(timeZone, now = new Date()) {
  const zone = !timeZone || timeZone === "device"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : timeZone;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  let hour = read("hour");
  if (hour === "24") hour = "00";
  const minute = Number(read("minute"));
  return {
    minute,
    key: `${read("year")}-${read("month")}-${read("day")} ${hour}:${read("minute")}`,
  };
}

export function quoteDue(everyMinutes, minute, minuteKey, lastKey) {
  const every = Number(everyMinutes);
  if (!PUSH_INTERVALS.includes(every)) return false;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return false;
  if (minute % every !== 0) return false;
  return String(minuteKey || "") !== String(lastKey || "");
}

export function mqttEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    return { ok: false, error: "MQTT URL must be mqtt://host:port or mqtts://host:port." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Put the MQTT username and password in their fields. The URL is mqtt://host:port." };
  }
  const secure = parsed.protocol === "mqtts:" || parsed.protocol === "ssl:" || parsed.protocol === "tls:";
  const plain = parsed.protocol === "mqtt:" || parsed.protocol === "tcp:";
  if (!secure && !plain) {
    return { ok: false, error: "MQTT URL must be mqtt://host:port or mqtts://host:port." };
  }
  const port = parsed.port ? Number(parsed.port) : (secure ? 8883 : 1883);
  if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "MQTT URL needs a host and a port from 1 to 65535." };
  }
  return { ok: true, host: parsed.hostname, port, secure };
}

function topicOk(topic) {
  const value = String(topic || "");
  return value.length > 0 && value.length <= 240 && !/[\u0000+#]/.test(value);
}

function clientIdOk(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function mqttString(value) {
  const body = Buffer.from(String(value), "utf8");
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  body.copy(out, 2);
  return out;
}

function remainingLength(length) {
  const bytes = [];
  let left = length;
  do {
    let byte = left % 128;
    left = Math.floor(left / 128);
    if (left > 0) byte |= 0x80;
    bytes.push(byte);
  } while (left > 0);
  return Buffer.from(bytes);
}

function packet(type, body) {
  return Buffer.concat([Buffer.from([type]), remainingLength(body.length), body]);
}

function connectPacket({ clientId, username, password }) {
  let flags = 0x02;
  const parts = [mqttString("MQTT"), null, mqttString(clientId)];
  if (username) {
    flags |= 0x80;
    parts.push(mqttString(username));
  }
  if (password) {
    flags |= 0x40;
    if (!username) parts.push(mqttString(""));
    if (!username) flags |= 0x80;
    parts.push(mqttString(password));
  }
  parts[1] = Buffer.from([0x04, flags, 0x00, 0x0f]);
  return packet(0x10, Buffer.concat(parts));
}

function publishPacket(topic, message) {
  return packet(0x30, Buffer.concat([mqttString(topic), Buffer.from(message)]));
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.origin || url;
  } catch {
    return "the MQTT broker";
  }
}

export function publishMqtt(config, payload) {
  const endpoint = mqttEndpoint(config?.url);
  if (!endpoint.ok) return Promise.resolve({ ok: false, error: endpoint.error });
  if (!topicOk(config?.topic)) return Promise.resolve({ ok: false, error: "MQTT topic is empty or uses + or #." });
  const message = JSON.stringify(payload);
  return new Promise((resolve) => {
    const socket = endpoint.secure
      ? tls.connect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host })
      : net.connect({ host: endpoint.host, port: endpoint.port });
    let settled = false;
    let incoming = Buffer.alloc(0);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(4000, () => finish({ ok: false, error: `MQTT broker at ${safeUrl(config.url)} did not answer.` }));
    socket.once("error", (error) => finish({ ok: false, error: `MQTT ${safeUrl(config.url)}: ${error.message}` }));
    const onData = (chunk) => {
      incoming = Buffer.concat([incoming, chunk]);
      if (incoming.length < 4) return;
      socket.off("data", onData);
      if (incoming[0] !== 0x20 || incoming[3] !== 0) {
        finish({ ok: false, error: `MQTT broker refused the connection (${incoming.length > 3 ? incoming[3] : "no reply"}).` });
        return;
      }
      socket.write(publishPacket(config.topic, message), (error) => {
        if (error) {
          finish({ ok: false, error: `MQTT ${safeUrl(config.url)}: ${error.message}` });
          return;
        }
        socket.setTimeout(0);
        settled = true;
        try { socket.end(Buffer.from([0xe0, 0x00])); } catch { socket.destroy(); }
        resolve({ ok: true, error: "" });
      });
    };
    socket.on("data", onData);
    socket.once(endpoint.secure ? "secureConnect" : "connect", () => {
      socket.write(connectPacket({
        clientId: config.clientId || "literature-clock",
        username: config.username || "",
        password: config.password || "",
      }));
    });
  });
}

export function createPush({ saved, onChange } = {}) {
  const state = {
    everyMinutes: 0,
    clientPush: false,
    events: false,
    sse: false,
    streamableHttp: false,
    mqtt: { ...DEFAULT_MQTT },
    live: { events: 0, sse: 0, streamableHttp: 0 },
    last: { at: "", time: "", ok: false, error: "" },
    cursor: "",
  };
  const every = Number(saved?.everyMinutes);
  if (every === 0 || PUSH_INTERVALS.includes(every)) state.everyMinutes = every;
  if (saved?.clientPush !== undefined) state.clientPush = Boolean(saved.clientPush);
  if (saved?.events !== undefined) state.events = Boolean(saved.events);
  if (saved?.sse !== undefined) state.sse = Boolean(saved.sse);
  if (saved?.streamableHttp !== undefined) state.streamableHttp = Boolean(saved.streamableHttp);
  if (saved?.mqtt && typeof saved.mqtt === "object") {
    const endpoint = mqttEndpoint(saved.mqtt.url);
    if (saved.mqtt.url && endpoint.ok) state.mqtt.url = String(saved.mqtt.url);
    if (topicOk(saved.mqtt.topic)) state.mqtt.topic = String(saved.mqtt.topic);
    if (typeof saved.mqtt.username === "string") state.mqtt.username = saved.mqtt.username.slice(0, 256);
    if (typeof saved.mqtt.password === "string") state.mqtt.password = saved.mqtt.password.slice(0, 256);
    if (clientIdOk(saved.mqtt.clientId)) state.mqtt.clientId = String(saved.mqtt.clientId);
    state.mqtt.enabled = Boolean(saved.mqtt.enabled) && endpoint.ok && topicOk(state.mqtt.topic);
  }

  function snapshot() {
    return {
      everyMinutes: state.everyMinutes,
      clientPush: state.clientPush,
      destinations: {
        events: state.events,
        sse: state.sse,
        streamableHttp: state.streamableHttp,
        mqtt: state.mqtt.enabled,
      },
      mqtt: {
        url: state.mqtt.url,
        topic: state.mqtt.topic,
        username: state.mqtt.username,
        clientId: state.mqtt.clientId,
        passwordSet: Boolean(state.mqtt.password),
      },
      live: { ...state.live },
      last: { ...state.last },
    };
  }

  function persist() {
    if (typeof onChange !== "function") return;
    onChange({
      everyMinutes: state.everyMinutes,
      clientPush: state.clientPush,
      events: state.events,
      sse: state.sse,
      streamableHttp: state.streamableHttp,
      mqtt: { ...state.mqtt },
    });
  }

  function update(patch = {}) {
    const next = {
      everyMinutes: state.everyMinutes,
      clientPush: state.clientPush,
      events: state.events,
      sse: state.sse,
      streamableHttp: state.streamableHttp,
      mqtt: { ...state.mqtt },
    };
    if (patch.pushEveryMinutes !== undefined) {
      const everyMinutes = Number(patch.pushEveryMinutes);
      if (everyMinutes !== 0 && !PUSH_INTERVALS.includes(everyMinutes)) {
        throw bad("Schedule must be off, or every 5, 10, 15, 30, or 60 minutes.", "bad_push");
      }
      next.everyMinutes = everyMinutes;
    }
    if (patch.clientPush !== undefined) next.clientPush = Boolean(patch.clientPush);
    if (patch.pushEvents !== undefined) next.events = Boolean(patch.pushEvents);
    if (patch.pushSse !== undefined) next.sse = Boolean(patch.pushSse);
    if (patch.pushHttp !== undefined) next.streamableHttp = Boolean(patch.pushHttp);
    if (patch.mqttUrl !== undefined) {
      const url = String(patch.mqttUrl || "").trim();
      if (url) {
        const endpoint = mqttEndpoint(url);
        if (!endpoint.ok) throw bad(endpoint.error, "bad_mqtt");
        next.mqtt.url = url;
      }
    }
    if (patch.mqttTopic !== undefined) {
      const topic = String(patch.mqttTopic || "").trim();
      if (topic && !topicOk(topic)) throw bad("MQTT topic cannot include + or #.", "bad_mqtt");
      if (topic) next.mqtt.topic = topic;
    }
    if (patch.mqttUsername !== undefined) next.mqtt.username = String(patch.mqttUsername || "").slice(0, 256);
    if (patch.mqttClearPassword) next.mqtt.password = "";
    if (typeof patch.mqttPassword === "string" && patch.mqttPassword.length) {
      if (patch.mqttPassword.length > 256) throw bad("MQTT password must be 256 characters or fewer.", "bad_mqtt");
      next.mqtt.password = patch.mqttPassword;
    }
    if (patch.mqttClientId !== undefined) {
      const clientId = String(patch.mqttClientId || "").trim() || "literature-clock";
      if (!clientIdOk(clientId)) throw bad("MQTT client id must be 1–64 letters, numbers, dashes, or underscores.", "bad_mqtt");
      next.mqtt.clientId = clientId;
    }
    if (patch.mqttEnabled !== undefined) next.mqtt.enabled = Boolean(patch.mqttEnabled);
    if (next.mqtt.enabled) {
      const endpoint = mqttEndpoint(next.mqtt.url);
      if (!endpoint.ok) throw bad(endpoint.error, "bad_mqtt");
      if (!topicOk(next.mqtt.topic)) throw bad("Set an MQTT topic before turning the broker on.", "bad_mqtt");
      if (!clientIdOk(next.mqtt.clientId)) throw bad("Set an MQTT client id before turning the broker on.", "bad_mqtt");
    }
    const intervalChanged = next.everyMinutes !== state.everyMinutes;
    state.everyMinutes = next.everyMinutes;
    state.clientPush = next.clientPush;
    state.events = next.events;
    state.sse = next.sse;
    state.streamableHttp = next.streamableHttp;
    state.mqtt = next.mqtt;
    if (intervalChanged) state.cursor = "";
    persist();
    return snapshot();
  }

  return {
    snapshot,
    update,
    broker: () => ({ ...state.mqtt }),
    setLive(live = {}) {
      state.live = {
        events: Math.max(0, Number(live.events) || 0),
        sse: Math.max(0, Number(live.sse) || 0),
        streamableHttp: Math.max(0, Number(live.streamableHttp) || 0),
      };
    },
    wrote({ at = "", time = "", ok = false, error = "" } = {}) {
      state.last = { at: String(at || ""), time: String(time || ""), ok: Boolean(ok), error: String(error || "") };
    },
    advance(key) {
      state.cursor = String(key || "");
    },
    cursor: () => state.cursor,
  };
}

export async function publishQuote({ push, store, prefs, deliver, mqttPublish = publishMqtt, scheduledKey = "", ensureEvents = false } = {}) {
  if (scheduledKey) push.advance(scheduledKey);
  const savedDest = push.snapshot().destinations;
  const dest = ensureEvents ? { ...savedDest, events: true } : savedDest;
  const at = new Date().toISOString();
  if (!dest.events && !dest.sse && !dest.streamableHttp && !dest.mqtt) {
    const error = "Pick a destination: event stream, SSE, Streamable HTTP, or MQTT.";
    push.wrote({ at, time: "", ok: false, error });
    throw bad(error, "bad_push");
  }
  try {
    const clock = prefs.snapshot();
    const quote = await store.quotePayload({
      source: clock.defaultSource,
      count: clock.defaultCount,
      now: prefs.zonedNow(),
    });
    const payload = {
      ok: true,
      at,
      time: quote.time,
      requested_source: quote.requested_source,
      requested_label: quote.requested_label,
      lines: quote.lines,
    };
    if ((dest.events || dest.sse || dest.streamableHttp) && typeof deliver === "function") {
      await deliver(payload, dest);
    }
    if (dest.mqtt) {
      const result = await mqttPublish(push.broker(), payload);
      if (!result.ok) {
        const error = result.error || "MQTT publish failed.";
        push.wrote({ at, time: payload.time, ok: false, error });
        const failure = bad(error, "bad_mqtt");
        failure.payload = payload;
        throw failure;
      }
    }
    push.wrote({ at, time: payload.time, ok: true, error: "" });
    return payload;
  } catch (error) {
    if (!error.payload) push.wrote({ at, time: "", ok: false, error: error.message });
    throw error;
  }
}
