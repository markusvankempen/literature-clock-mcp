/** Clock defaults. No MCP imports. */
const ZONES = ["device", "America/Toronto", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "UTC"];

export function zoneChoices(current) {
  const list = [...ZONES];
  if (current && !list.includes(current)) list.push(current);
  return list;
}

export function zoneOk(timeZone) {
  if (!timeZone || timeZone === "device") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function hourOk(hourClock) {
  return hourClock === "12" || hourClock === "24";
}

export function formatClock(hhmm, hourClock = "24") {
  const match = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return String(hhmm || "");
  if (hourClock !== "12") return `${String(match[1]).padStart(2, "0")}:${match[2]}`;
  let hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${match[2]} ${suffix}`;
}

export function clockFace(timeZone, now = new Date(), hourClock = "24") {
  const zone = !timeZone || timeZone === "device"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : timeZone;
  const twelve = hourClock === "12";
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: twelve ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: twelve ? "h12" : "h23",
  }).format(now);
  return { date, time, zone };
}

export function zonedNow(timeZone) {
  if (!timeZone || timeZone === "device") return new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const now = new Date();
  now.setHours(hour, minute, 0, 0);
  return now;
}

export function createPrefs({ saved, onChange, isSource } = {}) {
  const state = {
    defaultSource: "literature",
    defaultCount: 1,
    timeZone: "device",
    hourClock: "24",
  };
  if (saved?.defaultSource && (!isSource || isSource(saved.defaultSource))) state.defaultSource = saved.defaultSource;
  if (Number(saved?.defaultCount) >= 1 && Number(saved?.defaultCount) <= 8) state.defaultCount = Math.floor(Number(saved.defaultCount));
  if (saved?.timeZone && zoneOk(saved.timeZone)) state.timeZone = saved.timeZone;
  if (hourOk(saved?.hourClock)) state.hourClock = saved.hourClock;

  function snapshot() {
    return { ...state };
  }

  function update(patch = {}) {
    if (patch.defaultSource !== undefined) {
      if (!isSource?.(patch.defaultSource)) {
        const error = new Error(`unknown source "${patch.defaultSource}". Call list_sources.`);
        error.code = "bad_source";
        throw error;
      }
      state.defaultSource = patch.defaultSource;
    }
    if (patch.defaultCount !== undefined) {
      const count = Number(patch.defaultCount);
      if (!Number.isInteger(count) || count < 1 || count > 8) {
        const error = new Error("defaultCount must be an integer from 1 to 8.");
        error.code = "bad_count";
        throw error;
      }
      state.defaultCount = count;
    }
    if (patch.timeZone !== undefined) {
      if (!zoneOk(patch.timeZone)) {
        const error = new Error(`unknown time zone "${patch.timeZone}". Use device or an IANA name such as America/Toronto.`);
        error.code = "bad_zone";
        throw error;
      }
      state.timeZone = patch.timeZone || "device";
    }
    if (patch.hourClock !== undefined) {
      const hourClock = String(patch.hourClock);
      if (!hourOk(hourClock)) {
        const error = new Error('hourClock must be "12" or "24".');
        error.code = "bad_hour";
        throw error;
      }
      state.hourClock = hourClock;
    }
    if (typeof onChange === "function") onChange(snapshot());
    return snapshot();
  }

  return { snapshot, update, zonedNow: () => zonedNow(state.timeZone) };
}
