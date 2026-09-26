/** Scripted tool calls so /test can fill the log with successes, bad arguments, and a rejected credential. */
import { listSchemas, readSchema } from "./schemas.js";

const TIMES = ["09:05", "11:11", "14:30", "18:00", "23:59"];
const SOURCES = ["literature", "books", "yoda", "pirate", "mix"];
const SCHEMA_NAMES = ["quote", "source", "settings", "get_quote", "list_schemas"];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export async function generateTraffic({ store, security, rounds = 5 } = {}) {
  const n = Math.min(20, Math.max(1, Number(rounds) || 5));
  const log = [];
  let stopped = "";

  function note(tool, ok, outcome) {
    log.push({ tool, ok, outcome: String(outcome || "").slice(0, 240), at: new Date().toISOString() });
  }

  function gate(tool, headers = {}) {
    const allowed = security.authorizeCall(tool, headers);
    if (!allowed.ok) {
      note(tool, false, allowed.error || "denied");
      if (allowed.status === 429) stopped = "rate limit";
    }
    return allowed;
  }

  for (let round = 0; round < n && !stopped; round += 1) {
    const listed = gate("list_sources");
    if (stopped) break;
    if (listed.ok) {
      const sources = store.sourceCatalog();
      security.recordSuccess("list_sources", listed.principal, {});
      note("list_sources", true, `${sources.length} sources`);
    }

    const time = pick(TIMES);
    const source = pick(SOURCES);
    const quote = gate("get_quote");
    if (stopped) break;
    if (quote.ok) {
      try {
        const payload = await store.quotePayload({ time, source, count: 1 });
        security.recordSuccess("get_quote", quote.principal, { time, source });
        note("get_quote", true, payload.lines[0]?.citation || payload.time || time);
      } catch (error) {
        security.recordError("get_quote", quote.principal, { time, source }, error.message);
        note("get_quote", false, error.message);
      }
    }

    const counted = gate("count_lines");
    if (stopped) break;
    if (counted.ok) {
      const counts = store.countLines(store.stampOf(time));
      security.recordSuccess("count_lines", counted.principal, { time });
      note("count_lines", true, `${time}: ${counts.books} book lines`);
    }

    const schemas = gate("list_schemas");
    if (stopped) break;
    if (schemas.ok) {
      security.recordSuccess("list_schemas", schemas.principal, {});
      note("list_schemas", true, `${listSchemas().length} schemas`);
    }

    const schemaName = pick(SCHEMA_NAMES);
    const schema = gate("get_schema");
    if (stopped) break;
    if (schema.ok) {
      const doc = readSchema(schemaName);
      security.recordSuccess("get_schema", schema.principal, { name: schemaName });
      note("get_schema", true, doc.title);
    }

    const described = gate("describe_server");
    if (stopped) break;
    if (described.ok) {
      security.recordSuccess("describe_server", described.principal, {});
      note("describe_server", true, "ok");
    }

    const settings = gate("get_settings");
    if (stopped) break;
    if (settings.ok) {
      security.recordSuccess("get_settings", settings.principal, {});
      note("get_settings", true, "ok");
    }

    const badTime = gate("get_quote");
    if (stopped) break;
    if (badTime.ok) {
      try {
        await store.quotePayload({ time: "25:99", source: "books" });
        security.recordSuccess("get_quote", badTime.principal, { time: "25:99" });
        note("get_quote", true, "25:99 unexpectedly accepted");
      } catch (error) {
        security.recordError("get_quote", badTime.principal, { time: "25:99", source: "books" }, error.message);
        note("get_quote", false, error.message);
      }
    }

    const unknown = gate("get_schema");
    if (stopped) break;
    if (unknown.ok) {
      try {
        readSchema("not-a-schema");
        note("get_schema", true, "unknown schema unexpectedly found");
      } catch (error) {
        security.recordError("get_schema", unknown.principal, { name: "not-a-schema" }, error.message);
        note("get_schema", false, error.message);
      }
    }

    gate("get_quote", { authorization: "Bearer not-a-real-key" });
  }

  const failed = log.filter((row) => !row.ok).length;
  return {
    ok: true,
    rounds: n,
    calls: log.length,
    succeeded: log.length - failed,
    failed,
    stopped,
    log,
    at: new Date().toISOString(),
  };
}
