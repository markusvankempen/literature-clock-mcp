/** Quote file parsers. Kept in this package so `npx literature-clock-mcp` does not need the Chrome tree. */

export const VOICES = [
  ["literature", "Literature"],
  ["books", "Books"],
  ["mix", "Mix all"],
  ["surprise", "Surprise me"],
  ["yoda", "Yoda"],
  ["teacher", "Teacher"],
  ["pirate", "Pirate"],
  ["aussie", "Aussie"],
  ["canadian", "Canadian"],
  ["cat", "Cat"],
  ["chef", "Chef"],
  ["comedian", "Comedian"],
  ["cowboy", "Cowboy"],
  ["detective", "Detective"],
  ["english", "English"],
  ["french", "French"],
  ["hitchhiker", "Hitchhiker"],
  ["hockey", "Hockey"],
  ["librarian", "Librarian"],
  ["new-yorker", "New Yorker"],
  ["pilot", "Pilot"],
  ["robot", "Robot"],
  ["scottish", "Scottish"],
  ["soccer", "Soccer"],
  ["sports", "Sports"],
  ["star-trek", "Star Trek"],
  ["star-wars", "Star Wars"],
  ["vampire", "Vampire"],
];

export function soften(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
      if (body[0] === "#") {
        const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : all;
    })
    .replace(/\s+/g, " ");
}

export function clean(value) {
  return soften(value).trim();
}

export function plainQuote(quote) {
  if (!quote) return "";
  return clean(`${quote.quote_first || ""}${quote.quote_time_case || ""}${quote.quote_last || ""}`);
}

export function citation(quote) {
  const title = clean(quote?.title);
  const author = clean(quote?.author);
  if (title && author) return `${title}, by ${author}.`;
  return `${(title || author).replace(/\.$/, "")}.`;
}

export function parseFreeBooks(text) {
  const byMinute = new Map();
  let hhmm = null;
  const lines = String(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\d{2}:\d{2}$/.test(line)) {
      hhmm = line;
      continue;
    }
    if (line === "Time of day not stated") {
      hhmm = null;
      continue;
    }
    if (!hhmm || !line.includes("«")) continue;
    const next = lines[index + 1] || "";
    if (!next.startsWith("— ")) continue;
    const marked = line.match(/«([^»]*)»/);
    if (!marked) continue;
    const start = marked.index;
    const quote = {
      quote_first: line.slice(0, start),
      quote_time_case: marked[1],
      quote_last: line.slice(start + marked[0].length),
      title: next.slice(2).trim(),
      author: "",
      sfw: "yes",
    };
    if (!byMinute.has(hhmm)) byMinute.set(hhmm, []);
    byMinute.get(hhmm).push(quote);
  }
  return byMinute;
}

export function readable(quote) {
  const text = `${quote.quote_first}${quote.quote_time_case}${quote.quote_last}`;
  if (/[{}|[\]_]/.test(text)) return false;
  const letters = [...text].filter((ch) => /[\p{L}\s]/u.test(ch)).length;
  return letters >= 24 && letters / Math.max(text.length, 1) >= 0.75;
}

export function freeFor(byMinute, stamp) {
  const [hour, minute] = String(stamp).split("_").map(Number);
  const start = hour * 60 + minute;
  for (let back = 0; back < 1440; back += 1) {
    const slot = (start - back + 1440) % 1440;
    const key = `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`;
    const found = byMinute.get(key) || [];
    const kept = found.filter(readable);
    if (back === 0 && found.length) return kept.length ? kept : found;
    if (!kept.length) continue;
    return kept.map((quote) => ({ ...quote, note: `nearest line, ${key}` }));
  }
  return [];
}

export function parseVoice(text) {
  const byMinute = new Map();
  for (const block of String(text).split(/\n(?=\d{2}:\d{2}\n)/)) {
    const match = block.match(/^(\d{2}:\d{2})\n+([\s\S]*?)\n— ([^\n]+)/);
    if (!match) continue;
    const marked = match[2].match(/«([^»]*)»/);
    if (!marked) continue;
    const [before, after] = match[2].split(/«[^»]*»/);
    byMinute.set(match[1], {
      quote_first: before || "",
      quote_time_case: marked[1],
      quote_last: (after || "").trimEnd(),
      title: "",
      author: match[3].trim(),
      sfw: "yes",
    });
  }
  return byMinute;
}
