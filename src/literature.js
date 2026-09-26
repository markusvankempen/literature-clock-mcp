/** Johannes Enevoldsen's literature-clock collection (CC BY-NC-SA 2.5). */

const PRIMARY = "https://literature-clock.jenevoldsen.com/times/{stamp}.json";
const FALLBACK =
  "https://raw.githubusercontent.com/JohsEnevoldsen/literature-clock/master/docs/times/{stamp}.json";

const TIMEOUT_MS = 3000;

function normalize(row) {
  if (!row || typeof row !== "object") return null;
  const quote = {
    quote_first: String(row.quote_first || ""),
    quote_time_case: String(row.quote_time_case || ""),
    quote_last: String(row.quote_last || ""),
    title: String(row.title || ""),
    author: String(row.author || ""),
    sfw: String(row.sfw || "yes").toLowerCase(),
  };
  const text = `${quote.quote_first}${quote.quote_time_case}${quote.quote_last}`.trim();
  return text ? quote : null;
}

export async function fetchLiteratureQuotes(stamp, { sfw = true } = {}) {
  const urls = [PRIMARY, FALLBACK].map((template) => template.replace("{stamp}", stamp));
  for (const url of urls) {
    const rows = await loadJson(url);
    if (!rows?.length) continue;
    const quotes = rows.map(normalize).filter(Boolean);
    if (!quotes.length) continue;
    if (!sfw) return quotes;
    const safer = quotes.filter((quote) => quote.sfw === "yes");
    return safer.length ? safer : quotes;
  }
  return [];
}

async function loadJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "literature-clock-mcp/1.3" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
