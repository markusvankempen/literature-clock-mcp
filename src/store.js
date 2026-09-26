/** Data layer. No MCP imports. */
import {
  corpusInfo,
  labelOf,
  quotePayload,
  sourceCatalog,
  stampOf,
  countLines,
  voiceSlugs,
} from "./quotes.js";

export { corpusInfo, countLines, labelOf, quotePayload, sourceCatalog, stampOf, voiceSlugs };

export function createStore() {
  return { corpusInfo, countLines, labelOf, quotePayload, sourceCatalog, stampOf, voiceSlugs };
}
