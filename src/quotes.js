/** Load the bundled corpus and pick lines. No stdout. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  VOICES,
  parseFreeBooks,
  parseVoice,
  freeFor,
  readable,
  plainQuote,
  citation,
  soften,
} from "./corpus.js";
import { fetchLiteratureQuotes } from "./literature.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function corpusRoot() {
  const packaged = path.resolve(here, "../data");
  const dev = path.resolve(here, "../../chrome");
  if (fs.existsSync(path.join(packaged, "books/pd-times.txt"))) return packaged;
  if (fs.existsSync(path.join(dev, "books/pd-times.txt"))) return dev;
  throw new Error("Literature Clock corpus not found. Run npm run sync from the mcp directory.");
}

const META = new Set(["literature", "books", "mix", "surprise", "free"]);

export function voiceSlugs() {
  return VOICES.map(([id]) => id).filter((id) => !META.has(id));
}

function loadCorpus() {
  const root = corpusRoot();
  const books = parseFreeBooks(fs.readFileSync(path.join(root, "books/pd-times.txt"), "utf8"));
  const voices = new Map();
  const dir = path.join(root, "voices");
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".txt")) continue;
    voices.set(file.slice(0, -4), parseVoice(fs.readFileSync(path.join(dir, file), "utf8")));
  }
  return { books, voices, root };
}

const corpus = loadCorpus();

function pad(n) {
  return String(n).padStart(2, "0");
}

export function stampOf(time, now = new Date()) {
  if (!time || time === "now") {
    return `${pad(now.getHours())}_${pad(now.getMinutes())}`;
  }
  const text = String(time).trim();
  const twelve = text.match(/^(\d{1,2})[:_-](\d{2})\s*([ap])\.?m\.?$/i);
  if (twelve) {
    let hour = Number(twelve[1]);
    const minute = Number(twelve[2]);
    if (hour < 1 || hour > 12 || minute > 59) {
      const error = new Error("time is out of range");
      error.code = "bad_time";
      throw error;
    }
    if (twelve[3].toLowerCase() === "p" && hour < 12) hour += 12;
    if (twelve[3].toLowerCase() === "a" && hour === 12) hour = 0;
    return `${pad(hour)}_${pad(minute)}`;
  }
  const match = text.match(/^(\d{1,2})[:_-](\d{2})$/);
  if (!match) {
    const error = new Error('time must be "now", HH:MM, or h:mm AM/PM');
    error.code = "bad_time";
    throw error;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    const error = new Error("time is out of range");
    error.code = "bad_time";
    throw error;
  }
  return `${pad(hour)}_${pad(minute)}`;
}

export function labelOf(id) {
  return VOICES.find(([slug]) => slug === id)?.[1] || id;
}

function exactBookQuotes(stamp) {
  const key = stamp.replace("_", ":");
  const found = corpus.books.get(key) || [];
  const kept = found.filter(readable);
  return kept.length ? kept : found;
}

function tag(quotes, source, extra = {}) {
  return quotes.map((quote) => ({ ...quote, _source: source, ...extra }));
}

export async function poolFor(source, stamp, { sfw = true } = {}) {
  const key = stamp.replace("_", ":");
  if (source === "literature") {
    const exact = exactBookQuotes(stamp);
    if (exact.length) return tag(exact, "literature");
    const remote = await fetchLiteratureQuotes(stamp, { sfw });
    if (remote.length) return tag(remote, "literature");
    const fallback = freeFor(corpus.books, stamp);
    if (!fallback.length) return [];
    return fallback.map((quote) => ({
      ...quote,
      _source: "literature",
      note: [quote.note, "copyright-free books, library unreachable"].filter(Boolean).join(" — "),
      _fallback: "literature",
    }));
  }
  if (source === "books") {
    return tag(freeFor(corpus.books, stamp), "books");
  }
  if (source === "surprise") {
    const pool = ["books", ...voiceSlugs()];
    return poolFor(pool[Math.floor(Math.random() * pool.length)], stamp, { sfw });
  }
  if (source === "mix") {
    const tagged = [];
    for (const quote of (corpus.books.get(key) || []).filter(readable)) {
      tagged.push({ ...quote, _source: "books" });
    }
    for (const slug of voiceSlugs()) {
      const quote = corpus.voices.get(slug)?.get(key);
      if (quote) tagged.push({ ...quote, _source: slug });
    }
    if (tagged.length) return tagged;
    return tag(freeFor(corpus.books, stamp), "books");
  }
  const quote = corpus.voices.get(source)?.get(key);
  return quote ? [{ ...quote, _source: source }] : [];
}

export function knownSource(source) {
  if (!source) return "literature";
  if (["literature", "books", "mix", "surprise"].includes(source)) return source;
  if (corpus.voices.has(source)) return source;
  const error = new Error(`unknown source "${source}". Call list_sources.`);
  error.code = "bad_source";
  throw error;
}

export function isKnownSource(source) {
  try {
    knownSource(source);
    return true;
  } catch {
    return false;
  }
}

export function lineRecord(quote) {
  const source = quote._source || "books";
  const clean = { ...quote };
  delete clean._source;
  return {
    text: plainQuote(clean),
    citation: citation(clean).replace(/\.$/, ""),
    time_phrase: soften(clean.quote_time_case).trim(),
    source,
    source_label: labelOf(source),
    note: clean.note || "",
  };
}

export function countLines(stamp) {
  const key = stamp.replace("_", ":");
  const books = exactBookQuotes(stamp).length;
  const voices = voiceSlugs().map((id) => ({
    id,
    label: labelOf(id),
    count: corpus.voices.get(id)?.has(key) ? 1 : 0,
  }));
  const voiceTotal = voices.reduce((sum, item) => sum + item.count, 0);
  return {
    time: key,
    books,
    literature_local: books,
    mix: books + voiceTotal,
    voices,
  };
}

export async function pickLines(source, stamp, { avoid = "", count = 1, sfw = true } = {}) {
  const pool = await poolFor(source, stamp, { sfw });
  if (!pool.length) return [];
  const skip = new Set(
    String(avoid || "")
      .split("\n---\n")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const fresh = pool.filter((quote) => !skip.has(plainQuote(quote)));
  const bag = fresh.length ? [...fresh] : [...pool];
  const chosen = [];
  const n = Math.min(Math.max(1, count), bag.length, 8);
  while (chosen.length < n && bag.length) {
    const index = Math.floor(Math.random() * bag.length);
    chosen.push(bag.splice(index, 1)[0]);
  }
  return chosen;
}

export function sourceCatalog() {
  return [
    {
      id: "literature",
      label: "Literature",
      kind: "corpus",
      note: "Johannes Enevoldsen's literature-clock collection (CC BY-NC-SA 2.5). Exact-minute bundled lines first, then the online library, then copyright-free books if unreachable.",
    },
    { id: "books", label: "Books", kind: "corpus", note: "Copyright-free book lines. An empty minute uses the nearest earlier line." },
    { id: "mix", label: "Mix all", kind: "meta", note: "Exact minute from books and every voice." },
    { id: "surprise", label: "Surprise me", kind: "meta", note: "One random source, then a line from it." },
    ...voiceSlugs().map((id) => ({
      id,
      label: labelOf(id),
      kind: "voice",
      note: "Original lines for this clock. Not quotations.",
    })),
  ];
}

export async function quotePayload({ time, source, avoid, count, now, sfw = true } = {}) {
  const stamp = stampOf(time, now);
  const chosen = knownSource(source);
  const picked = await pickLines(chosen, stamp, { avoid, count: count || 1, sfw });
  const lines = picked.map(lineRecord);
  return {
    ok: true,
    time: stamp.replace("_", ":"),
    requested_source: chosen,
    requested_label: labelOf(chosen),
    lines,
    next: lines.length
      ? "Pass avoid set to a line's text to ask for a different line at the same minute."
      : "No line for that minute in this source. Try source=literature, source=books, or source=mix.",
  };
}

export function corpusInfo() {
  return {
    root: corpus.root,
    voice_count: corpus.voices.size,
    book_minutes: corpus.books.size,
  };
}
