/** Store-level sanity check. No port, no MCP. Exits 0 or 1. */
import { createStore } from "./store.js";

const store = createStore();
const sources = store.sourceCatalog();
if (!sources.some((item) => item.id === "literature")) {
  console.error("literature source missing");
  process.exit(1);
}
if (!sources.some((item) => item.id === "mix")) {
  console.error("mix source missing");
  process.exit(1);
}
if (sources.filter((item) => item.kind === "voice").length < 20) {
  console.error("voice catalog is short");
  process.exit(1);
}
const yoda = await store.quotePayload({ time: "09:05", source: "yoda" });
if (yoda.lines[0]?.source !== "yoda" || !yoda.lines[0].text) {
  console.error("yoda 09:05 missing");
  process.exit(1);
}
const mix = await store.quotePayload({ time: "14:30", source: "mix", count: 3 });
if (mix.lines.length !== 3) {
  console.error("mix count");
  process.exit(1);
}
const lit = await store.quotePayload({ time: "09:05", source: "literature" });
if (lit.lines[0]?.source !== "literature" || !lit.lines[0].text) {
  console.error("literature 09:05 missing");
  process.exit(1);
}
if (store.stampOf("9:05 PM") !== "21_05" || store.stampOf("12:00 AM") !== "00_00" || store.stampOf("12:00 PM") !== "12_00") {
  console.error("12-hour stamp");
  process.exit(1);
}
const counts = store.countLines(store.stampOf("09:05"));
if (counts.books < 1 || !counts.voices.some((item) => item.id === "yoda" && item.count === 1)) {
  console.error("count_lines 09:05");
  process.exit(1);
}
let bad = false;
try {
  await store.quotePayload({ time: "25:99", source: "books" });
} catch (error) {
  bad = error.code === "bad_time";
}
if (!bad) {
  console.error("bad time was accepted");
  process.exit(1);
}
console.log(`literature-clock-mcp smoke ok — ${sources.length} sources`);
