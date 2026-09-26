/** Saved clock, admin posture, and the quote schedule. API keys stay in memory. User passwords are stored as hashes. The MQTT password is stored so a quote can be published; get_settings does not return it. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.state.json");

export function loadDisk() {
  if (process.env.INK_CLOCK_IGNORE_STATE === "1") return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveDisk(partial) {
  if (process.env.INK_CLOCK_IGNORE_STATE === "1") return;
  const next = { ...loadDisk(), ...partial };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}
