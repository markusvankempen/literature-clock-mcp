#!/usr/bin/env node
/**
 * One MCP server. Two ways to run it.
 *
 *   MCP_MODE=stdio node src/index.js
 *   MCP_MODE=http  node src/index.js
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./create-server.js";
import { startHttp } from "./http.js";
import { createPrefs } from "./prefs.js";
import { createPush } from "./push.js";
import { isKnownSource } from "./quotes.js";
import { createSecurity } from "./security.js";
import { loadDisk, saveDisk } from "./state.js";
import { createStore } from "./store.js";
import { VERSION } from "./version.js";

const mode = (process.env.MCP_MODE || (process.argv.includes("--http") ? "http" : "stdio")).toLowerCase();
const store = createStore();
const disk = loadDisk();
const security = createSecurity({
  saved: disk.security,
  onChange: (securityState) => saveDisk({ security: securityState }),
});
const prefs = createPrefs({
  saved: disk.clock,
  isSource: isKnownSource,
  onChange: (clock) => saveDisk({ clock }),
});
const push = createPush({
  saved: disk.push,
  onChange: (schedule) => saveDisk({ push: schedule }),
});

/** stdio has no request headers. Read the credential from the environment on every call. */
function stdioHeaders() {
  const headers = {};
  if (process.env.MCP_API_KEY) headers["x-api-key"] = process.env.MCP_API_KEY;
  if (process.env.MCP_USERNAME) {
    const pair = `${process.env.MCP_USERNAME}:${process.env.MCP_PASSWORD || ""}`;
    headers.authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
  }
  if (process.env.TENANT_ID) headers["x-tenant-id"] = process.env.TENANT_ID;
  headers["x-literature-clock-transport"] = "stdio";
  return headers;
}

if (mode === "http") {
  await startHttp({ store, security, prefs, push });
} else {
  if (!security.protocolOn("stdio")) {
    console.error("literature-clock-mcp stdio is turned off in settings. describe_server and update_settings still answer.");
  }
  const server = createMcpServer({ store, security, prefs, push, requestHeaders: stdioHeaders });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`literature-clock-mcp ${VERSION} stdio — auth mode=${security.snapshot().authMode}. Quotes stay on this machine.`);
}
