/** Schema catalog for list_schemas and get_schema. Tool schemas are published by create-server.js. */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const Line = z.object({
  text: z.string(),
  citation: z.string(),
  time_phrase: z.string(),
  source: z.string(),
  source_label: z.string(),
  note: z.string(),
});

export const Source = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string(),
  note: z.string(),
});

const ClockSettings = z.object({
  defaultSource: z.string().describe("literature, books, mix, surprise, or a voice id."),
  defaultCount: z.number().int().describe("Lines returned when count is omitted. 1–8."),
  timeZone: z.string().describe("device, or an IANA zone such as America/Toronto."),
  hourClock: z.enum(["12", "24"]).describe("12-hour or 24-hour display."),
});

const entries = [];

export function jsonSchema(schema) {
  const zodSchema = schema instanceof z.ZodType ? schema : z.object(schema || {});
  const converted = zodToJsonSchema(zodSchema, { target: "jsonSchema7", $refStrategy: "none" });
  if (converted && typeof converted === "object") delete converted.$schema;
  return converted;
}

export function publishSchema(entry) {
  const next = { ...entry };
  const index = entries.findIndex((item) => item.name === next.name);
  if (index >= 0) entries[index] = next;
  else entries.push(next);
}

export function listSchemas() {
  return entries.map(({ name, kind, title, description }) => ({ name, kind, title, description }));
}

export function readSchema(name) {
  const found = entries.find((item) => item.name === name);
  if (!found) {
    const error = new Error(`unknown schema "${name}". Call list_schemas.`);
    error.code = "bad_schema";
    throw error;
  }
  return {
    ok: true,
    name: found.name,
    kind: found.kind,
    title: found.title,
    description: found.description,
    schema: found.schema,
    ...(found.inputSchema ? { inputSchema: found.inputSchema } : {}),
    ...(found.outputSchema ? { outputSchema: found.outputSchema } : {}),
    next: found.next,
  };
}

publishSchema({
  name: "quote",
  kind: "line",
  title: "Quote line",
  description: "One line inside get_quote lines[].",
  schema: jsonSchema(Line),
  next: "Call get_quote. Each entry in lines matches this schema.",
});

publishSchema({
  name: "source",
  kind: "catalog",
  title: "Quote source",
  description: "One entry from list_sources.",
  schema: jsonSchema(Source),
  next: "Call list_sources, then pass an id to get_quote as source.",
});

publishSchema({
  name: "settings",
  kind: "settings",
  title: "Clock defaults",
  description: "Saved clock defaults from get_settings.",
  schema: jsonSchema(ClockSettings),
  next: "Call get_settings for the live values, or update_settings to change them.",
});
