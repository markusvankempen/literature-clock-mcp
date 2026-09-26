/** Operations pages. The clock itself stays in pages.js. Colors match that paper page. */
import { TOOL_CATALOG } from "./create-server.js";
import { AUTHOR, HOME, LITERATURE } from "./meta.js";
import { clockFace, zoneChoices } from "./prefs.js";
import { VERSION } from "./version.js";

const AUTH_MODE_COPY = {
  off: ["Open", "No credential needed. Every tool is callable."],
  write: ["Writes protected", "Read tools stay open. update_settings needs a key."],
  all: ["All tools", "Every tool except describe_server needs a credential."],
};

const DEFAULT_ARGS = {
  describe_server: {},
  list_sources: {},
  get_quote: { time: "09:05", source: "literature" },
  count_lines: { time: "09:05" },
  get_settings: {},
  update_settings: { defaultSource: "literature", defaultCount: 1 },
  list_schemas: {},
  get_schema: { name: "quote" },
};

const ARG_FIELDS = {
  describe_server: "No arguments.",
  list_sources: "No arguments.",
  get_quote: "time (HH:MM or now), source, avoid, count (1–8).",
  count_lines: "time (HH:MM or now). Local lines only; does not fetch the library.",
  get_settings: "No arguments. Includes the quote schedule. The MQTT password is not included.",
  update_settings: "defaultSource, defaultCount, timeZone, authMode, rateLimit, auditMode, tool gates, pushEveryMinutes, pushEvents, pushSse, pushHttp, MQTT fields.",
  list_schemas: "No arguments. Returns quote, source, settings, and every tool name.",
  get_schema: "name — quote, source, settings, or a tool name such as get_quote.",
};

const css = `
:root {
  color-scheme: light;
  --paper: #f4ecd8; --ink: #2b2416; --muted: #6e6048; --line: #ddcfb4; --accent: #8b3a2a;
  --cream: #fbf6ea; --soft: #efe6d2; --good: #3d5c45; --wash: #f3e2c8;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 17px/1.45 Palatino, "Palatino Linotype", Georgia, serif; }
.header { position: sticky; top: 0; z-index: 20; background: var(--paper); border-bottom: 1px solid var(--line); }
.header-main { max-width: 1100px; margin: 0 auto; padding: 10px 20px 0; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.brand { font: 500 1.2rem/1.2 Palatino, "Palatino Linotype", Georgia, serif; color: var(--ink); text-decoration: none; white-space: nowrap; }
.brand span { color: var(--muted); font-weight: 400; font-size: 0.8rem; margin-left: 6px; }
.header-clock { font-size: 0.92rem; white-space: nowrap; }
.header-zone { color: var(--muted); margin-left: 8px; }
.nav-tabs { max-width: 1100px; margin: 0 auto; padding: 0 12px; display: flex; gap: 0; overflow-x: auto; }
.nav-tab { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; color: var(--accent); text-decoration: none; font-size: 0.95rem; border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.nav-tab .lock { font-size: 0.72rem; line-height: 1; }
a.btn { display: inline-block; background: var(--ink); color: var(--paper); text-decoration: none; border-radius: 4px; padding: 6px 12px; }
.nav-tab:hover { color: var(--ink); }
.nav-tab.active { color: var(--ink); border-bottom-color: var(--accent); }
.burger { display: none; background: transparent; color: var(--ink); border: 1px solid var(--line); width: 44px; height: 44px; padding: 11px 10px; flex-direction: column; justify-content: center; gap: 5px; }
.burger span { display: block; height: 2px; background: var(--ink); border-radius: 1px; transition: transform .15s ease, opacity .15s ease; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.page-head h2 { margin: 0; }
.main { max-width: 1100px; margin: 0 auto; padding: 22px 20px 80px; }
.eyebrow { color: var(--accent); font-size: 0.78rem; letter-spacing: .08em; text-transform: uppercase; }
h2 { font-weight: 500; font-size: 1.45rem; line-height: 1.2; margin: 6px 0 12px; }
h2 span { color: var(--accent); }
h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 20px 0 8px; font-weight: 500; }
.muted { color: var(--muted); }
p.muted, .byline { font-size: 0.95rem; margin: 0 0 14px; }
.byline { color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin: 14px 0; }
.stat { background: var(--cream); border: 1px solid var(--line); border-radius: 4px; padding: 10px 13px; }
.cwd-line { background: var(--cream); border: 1px solid var(--line); border-radius: 4px; padding: 10px 13px; margin: 0 0 14px; }
.cwd-line strong { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 3px; font-weight: 500; }
.cwd-line span { display: block; overflow-wrap: anywhere; }
.stat strong { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 3px; font-weight: 500; }
.stat b { font-weight: 500; font-size: 1.05rem; }
.stat.warn b { color: var(--accent); }
.stat.ok b { color: var(--good); }
.tag { display: inline-block; background: var(--soft); color: var(--ink); border-radius: 4px; padding: 2px 8px; font-size: 0.78rem; }
.tag.coral { background: var(--wash); color: var(--accent); }
.tag.grey { background: var(--line); color: var(--muted); }
.tag.amber { background: var(--wash); color: #7a5000; }
.tbl-wrap { overflow-x: auto; border: 1px solid var(--line); margin: 8px 0; }
table { width: 100%; border-collapse: collapse; background: var(--cream); min-width: 400px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 0.92rem; }
th { background: var(--ink); color: var(--paper); font-size: 0.75rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 500; }
tr:last-child td { border-bottom: 0; }
tr.err-row td { background: var(--wash); }
tr.err-row td:first-child { border-left: 3px solid var(--accent); }
td.mono, .mono { font-family: ui-monospace, Menlo, monospace; font-size: 0.82rem; }
td.ts { color: var(--muted); font-size: 0.78rem; white-space: nowrap; font-family: ui-monospace, Menlo, monospace; }
.page-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--line); margin: 0 0 18px; flex-wrap: wrap; }
.page-tab { background: none; border: 0; padding: 8px 14px; font: inherit; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.page-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.pane { display: none; }
.pane.active { display: block; }
.search-row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
.search-input { flex: 1 1 220px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; font: inherit; color: inherit; }
a { color: var(--accent); }
button, input, select, textarea { font: inherit; color: inherit; }
input[type=text], input[type=number], input[type=password], select, textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: transparent; }
button { background: var(--ink); color: var(--paper); border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
button.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
button.danger { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
pre { background: var(--soft); color: var(--ink); padding: 12px; border-radius: 4px; overflow: auto; font: 0.78rem/1.45 ui-monospace, Menlo, monospace; margin: 8px 0; white-space: pre-wrap; }
.checklist { list-style: none; padding: 0; display: grid; gap: 5px; }
.checklist li { padding: 8px 10px 8px 28px; background: var(--cream); border: 1px solid var(--line); position: relative; font-size: 0.95rem; }
.checklist li::before { content: "✓"; position: absolute; left: 10px; color: var(--good); }
.checklist li.fail { background: var(--wash); }
.checklist li.fail::before { content: "✗"; color: var(--accent); }
.warn { color: var(--accent); }
.panel { background: var(--cream); border: 1px solid var(--line); padding: 14px 16px; margin: 10px 0; }
.panel h4 { margin: 0 0 4px; font-size: 1.05rem; font-weight: 500; }
.panel p { margin: 4px 0 10px; color: var(--muted); }
.modes { display: grid; gap: 7px; margin-bottom: 10px; }
.mode { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border: 1px solid var(--line); background: transparent; cursor: pointer; }
.mode.on { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
.mode b { display: block; }
.mode span { font-size: 0.92rem; color: var(--muted); }
.field { display: grid; gap: 3px; font-size: 0.85rem; color: var(--muted); flex: 1 1 140px; }
.field-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.secret { background: var(--ink); color: var(--paper); padding: 11px 13px; margin: 8px 0; }
.secret code { color: var(--paper); word-break: break-all; }
.detail-row { display: none; }
.detail-row.open { display: table-row; }
.detail-cell { background: var(--wash); padding: 10px 14px !important; }
.detail-cell pre { margin: 0; background: var(--soft); color: var(--ink); font-size: 0.75rem; max-height: 220px; }
.expand-btn { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.78rem; padding: 0; }
.curl-block { position: relative; margin: 6px 0; }
.curl-block .copy-btn { position: absolute; top: 8px; right: 8px; background: var(--ink); color: var(--paper); border: 0; border-radius: 4px; padding: 3px 8px; font-size: 0.75rem; cursor: pointer; }
.footer-links { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 0.85rem; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; }
.clock-sheet { max-width: 40rem; }
.quote { font-size: 1.55rem; line-height: 1.4; margin: 4px 0 8px; }
.quote .time { color: var(--accent); }
.clock-meta { margin: 0 0 4px; }
img { max-width: 100%; height: auto; }
@media (max-width: 900px) {
  .header-main { flex-wrap: wrap; align-items: flex-start; padding: 12px 16px 0; }
  .brand, .header-clock { min-width: 0; white-space: normal; }
  .header-clock { margin-left: auto; text-align: right; overflow-wrap: anywhere; }
  .nav-tabs { flex-wrap: wrap; overflow: visible; padding: 0 8px; }
  .main { padding: 18px 16px 72px; }
  .quote { font-size: 1.35rem; }
  .tbl-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { min-width: 36rem; }
}
@media (max-width: 640px) {
  body { font-size: 16px; }
  .header { padding-top: env(safe-area-inset-top); }
  .header-main { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
  .burger { display: inline-flex; margin-left: auto; }
  .brand { font-size: 1.08rem; flex: 1 1 auto; min-width: 0; }
  .header-clock { margin-left: 0; text-align: left; font-size: 0.88rem; flex: 1 1 100%; }
  .header-zone { display: block; margin-left: 0; }
  .header.open .burger span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .header.open .burger span:nth-child(2) { opacity: 0; }
  .header.open .burger span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
  .nav-tabs { display: none; flex-direction: column; padding: 0; border-top: 1px solid var(--line); }
  .header.open .nav-tabs { display: flex; }
  .nav-tab { padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .nav-tab.active { background: var(--cream); }
  .main { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); padding-bottom: max(64px, env(safe-area-inset-bottom)); }
  .page-head { flex-direction: column; align-items: flex-start; }
  h2 { font-size: 1.28rem; }
  .quote { font-size: 1.22rem; }
  .field { flex-basis: 100%; }
  .row button { flex: 1 1 calc(50% - 10px); min-height: 44px; }
  .nav-tab, .page-tab, .row button, .panel button, form > button { min-height: 44px; }
  .stats { grid-template-columns: 1fr 1fr; }
  td.ts { white-space: normal; }
  .curl-block .copy-btn { position: static; margin-bottom: 6px; }
  pre { padding: 10px; }
  table.stack { min-width: 0; }
  table.stack thead { display: none; }
  table.stack, table.stack tbody, table.stack tr, table.stack td { display: block; width: auto; }
  table.stack tr { padding: 8px 12px 10px; border-bottom: 1px solid var(--line); }
  table.stack td { border: 0; padding: 3px 0; }
  table.stack td[data-label]::before { content: attr(data-label); display: block; font-size: 0.68rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
  .tbl-wrap:has(table.stack) { overflow: visible; }
}
`;

const TAB_JS = `
<script>
function showPane(group, id) {
  document.querySelectorAll('[data-group="' + group + '"].pane').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('[data-group="' + group + '"].page-tab').forEach(function (t) { t.classList.remove('active'); });
  var pane = document.getElementById(id);
  if (pane) pane.classList.add('active');
  var tab = document.querySelector('[data-group="' + group + '"][data-target="' + id + '"]');
  if (tab) tab.classList.add('active');
}
function filterTable(inputId, tableId, countId) {
  var q = document.getElementById(inputId).value.toLowerCase();
  var tbody = document.querySelector('#' + tableId + ' tbody');
  if (!tbody) return;
  var shown = 0;
  tbody.querySelectorAll('tr:not(.detail-row)').forEach(function (row) {
    var match = row.textContent.toLowerCase().includes(q);
    row.style.display = match ? '' : 'none';
    if (match) shown += 1;
    var next = row.nextElementSibling;
    if (next && next.classList.contains('detail-row')) next.style.display = match && next.classList.contains('open') ? '' : 'none';
  });
  var el = document.getElementById(countId);
  if (el) el.textContent = q ? shown + ' match' + (shown === 1 ? '' : 'es') : '';
}
function toggleDetail(btn, rowId) {
  var row = document.getElementById(rowId);
  if (!row) return;
  var open = row.classList.toggle('open');
  row.style.display = open ? '' : 'none';
  btn.textContent = open ? '▲ collapse' : '▼ detail';
}
function copyFromData(btn) {
  navigator.clipboard.writeText(btn.dataset.copy).then(function () {
    var orig = btn.textContent;
    btn.textContent = 'copied';
    setTimeout(function () { btn.textContent = orig; }, 1200);
  });
}
function layoutTables() {
  var narrow = window.innerWidth <= 640;
  document.querySelectorAll('.tbl-wrap table').forEach(function (table) {
    var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    table.querySelectorAll('tbody tr').forEach(function (row) {
      if (row.classList.contains('detail-row')) return;
      Array.prototype.forEach.call(row.children, function (cell, index) {
        if (heads[index]) cell.setAttribute('data-label', heads[index]);
        else cell.removeAttribute('data-label');
      });
    });
    table.classList.toggle('stack', narrow);
  });
}
function openHashedPane() {
  var hash = location.hash.slice(1);
  if (!hash) return;
  var tab = document.querySelector('[data-target="' + hash + '"]');
  if (tab && tab.dataset.group) showPane(tab.dataset.group, hash);
}
window.addEventListener('DOMContentLoaded', function () {
  openHashedPane();
  layoutTables();
});
window.addEventListener('hashchange', openHashedPane);
window.addEventListener('resize', function () {
  layoutTables();
  if (window.innerWidth > 640) closeMenu();
});
function toggleMenu(btn) {
  var header = btn.closest('.header');
  var open = header.classList.toggle('open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
}
function closeMenu() {
  var header = document.querySelector('.header');
  var btn = document.querySelector('.burger');
  if (!header) return;
  header.classList.remove('open');
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Menu');
  }
}
document.addEventListener('click', function (event) {
  if (!event.target.closest('.header')) closeMenu();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') closeMenu();
});
</script>`;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

function asClock(timeZone, hourClock) {
  if (timeZone && typeof timeZone === "object") {
    return {
      timeZone: timeZone.timeZone || "device",
      hourClock: timeZone.hourClock === "12" ? "12" : "24",
    };
  }
  return {
    timeZone: timeZone || "device",
    hourClock: hourClock === "12" ? "12" : "24",
  };
}

export function pageShell({ title, tab, body, timeZone = "device", hourClock = "24" }) {
  const clock = asClock(timeZone, hourClock);
  const face = clockFace(clock.timeZone, new Date(), clock.hourClock);
  const locked = new Set(["/admin", "/log"]);
  const tabs = [
    ["/", "Clock"],
    ["/health", "Health"],
    ["/test", "Test"],
    ["/tools", "Tools"],
    ["/admin", "Settings"],
    ["/log", "Log"],
    ["/help", "Docs"],
  ].map(([href, label]) => {
    const mark = locked.has(href) ? `<span class="lock" title="Sign-in required" aria-label="Sign-in required">🔒</span>` : "";
    return `<a class="nav-tab${tab === href ? " active" : ""}" href="${href}">${mark}${label}</a>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <style>${css}</style>
</head>
<body>
  <header class="header">
    <div class="header-main">
      <a class="brand" href="/">Literature Clock <span>v${esc(VERSION)}</span></a>
      <button type="button" class="burger" aria-label="Menu" aria-expanded="false" aria-controls="site-nav" onclick="toggleMenu(this)"><span></span><span></span><span></span></button>
      <div class="header-clock">${esc(face.date)}, ${esc(face.time)}<span class="header-zone">${esc(face.zone)}</span></div>
    </div>
    <nav id="site-nav" class="nav-tabs">${tabs}</nav>
  </header>
  <main class="main">${body}
    <div class="footer-links">
      <span>${esc(AUTHOR.name)}</span>
      <a href="${esc(HOME)}" target="_blank" rel="noopener">Home</a>
      <a href="${esc(AUTHOR.url)}" target="_blank" rel="noopener">Website</a>
      <a href="${esc(AUTHOR.github)}" target="_blank" rel="noopener">GitHub</a>
    </div>
  </main>
  ${TAB_JS}
</body>
</html>`;
}

function stats(rows) {
  return `<div class="stats">${rows.map(([label, value, cls = ""]) => `<div class="stat${cls ? ` ${cls}` : ""}"><strong>${esc(label)}</strong><b>${esc(value)}</b></div>`).join("")}</div>`;
}

function searchRow(inputId, tableId, placeholder) {
  return `<div class="search-row">
    <input class="search-input" id="${inputId}" type="text" placeholder="${esc(placeholder)}" oninput="filterTable('${inputId}','${tableId}','cnt-${inputId}')">
    <span class="muted" id="cnt-${inputId}"></span>
  </div>`;
}

function pageTabs(group, tabs) {
  return `<div class="page-tabs">${tabs.map(([id, label], index) => `<button type="button" class="page-tab${index === 0 ? " active" : ""}" data-group="${group}" data-target="${id}" onclick="showPane('${group}','${id}'); location.hash='${id}'">${esc(label)}</button>`).join("")}</div>`;
}

function curlBlock(code) {
  return `<div class="curl-block"><pre>${esc(code)}</pre><button type="button" class="copy-btn" data-copy="${esc(code)}" onclick="copyFromData(this)">copy</button></div>`;
}

function toolTryModal() {
  return `
    <div id="toolTryModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;align-items:center;justify-content:center">
      <div style="background:#fbf6ea;border:1px solid #ddcfb4;padding:24px;width:min(640px,94vw);display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h4 style="margin:0">Run <span id="tryToolName"></span></h4>
          <button type="button" class="secondary" onclick="closeToolTry()">Close</button>
        </div>
        <label class="field">Arguments (JSON)
          <textarea id="tryToolArgs" rows="7"></textarea>
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" id="tryRunBtn" onclick="runToolTry()">Run</button>
        </div>
        <div id="tryResult" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
            <span class="muted" style="font-size:0.85rem">Response</span>
            <span style="display:flex;gap:8px">
              <button type="button" class="secondary" onclick="copyToolJson(this)">Copy JSON</button>
              <button type="button" class="secondary" onclick="openToolJsonTab()">Open in new tab</button>
            </span>
          </div>
          <pre id="tryResultPre" style="max-height:320px;margin:0"></pre>
        </div>
      </div>
    </div>
    <script>
      var tryTool = "";
      function openToolTryFromData(btn) {
        tryTool = btn.dataset.tool;
        document.getElementById("tryToolName").textContent = tryTool;
        document.getElementById("tryToolArgs").value = btn.dataset.args;
        document.getElementById("tryResult").style.display = "none";
        document.getElementById("tryResultPre").textContent = "";
        document.getElementById("toolTryModal").style.display = "flex";
      }
      function closeToolTry() { document.getElementById("toolTryModal").style.display = "none"; }
      function showToolResult(text) {
        document.getElementById("tryResultPre").textContent = text;
        document.getElementById("tryResult").style.display = "block";
      }
      function markCopied(btn) {
        var orig = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = orig; }, 1200);
      }
      function copyWithFallback(text) {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
        area.remove();
        return ok;
      }
      function copyToolJson(btn) {
        var text = document.getElementById("tryResultPre").textContent || "";
        var settled = false;
        function succeed() { if (settled) return; settled = true; markCopied(btn); }
        function fail() {
          if (settled) return;
          if (copyWithFallback(text)) succeed();
          else { settled = true; alert("Could not copy the JSON."); }
        }
        if (navigator.clipboard && window.isSecureContext) {
          var timer = setTimeout(fail, 400);
          navigator.clipboard.writeText(text).then(function () { clearTimeout(timer); succeed(); }, function () { clearTimeout(timer); fail(); });
        } else fail();
      }
      function openToolJsonTab() {
        var text = document.getElementById("tryResultPre").textContent || "";
        var title = (tryTool || "tool") + " result";
        try {
          localStorage.setItem("literature-clock-tool-result", JSON.stringify({ title: title, text: text }));
        } catch (error) {
          alert("Could not store the JSON for a new tab.");
          return;
        }
        var win = window.open("/tools/result", "_blank");
        if (!win) alert("The browser blocked the new tab.");
      }
      async function runToolTry() {
        var btn = document.getElementById("tryRunBtn");
        var args = {};
        try { args = JSON.parse(document.getElementById("tryToolArgs").value || "{}"); }
        catch (error) { alert("Invalid JSON: " + error.message); return; }
        btn.disabled = true;
        try {
          var response = await fetch("/mcp", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tryTool, arguments: args } })
          });
          var json = await response.json();
          showToolResult(JSON.stringify(json, null, 2));
        } catch (error) {
          showToolResult(String(error));
        }
        btn.disabled = false;
      }
      async function loadToolSchema() {
        var pre = document.getElementById("schemaOut");
        pre.textContent = "Loading tools/list…";
        var response = await fetch("/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        });
        pre.textContent = JSON.stringify(await response.json(), null, 2);
      }
    </script>`;
}

function tryButton(name) {
  const args = JSON.stringify(DEFAULT_ARGS[name] || {}, null, 2);
  return `<button type="button" class="secondary" style="padding:3px 9px;font-size:12px" data-tool="${esc(name)}" data-args="${esc(args)}" onclick="openToolTryFromData(this)">Run</button>`;
}

function clockOf(when) {
  return String(when || "").slice(11, 19) || "—";
}

export function toolResultPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Tool result</title>
  <style>
    body { margin: 0; background: #f4ecd8; color: #2b2416; font: 17px/1.45 Palatino, "Palatino Linotype", Georgia, serif; }
    header { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 22px 0 8px; border-bottom: 1px solid #ddcfb4; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    h1 { font-weight: 500; font-size: 1.35rem; margin: 0; }
    @media (max-width: 640px) {
      body { font-size: 16px; }
      header, main { width: min(960px, calc(100% - 24px)); }
      h1 { font-size: 1.15rem; }
    }
    a { color: #8b3a2a; }
    main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 16px 0 40px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 13px/1.45 ui-monospace, Menlo, monospace; background: #efe6d2; padding: 14px; }
  </style>
</head>
<body>
  <header><h1 id="title">Tool result</h1><a href="/tools">Back to tools</a></header>
  <main><pre id="out">No JSON stored yet. Run a tool, then choose Open in new tab.</pre></main>
  <script>
    try {
      var saved = JSON.parse(localStorage.getItem("literature-clock-tool-result") || "null");
      if (saved && saved.text) {
        document.title = saved.title || "Tool result";
        document.getElementById("title").textContent = saved.title || "Tool result";
        document.getElementById("out").textContent = saved.text;
      }
    } catch (error) {}
  </script>
</body>
</html>`;
}

export function healthPage(info, timeZone = "device") {
  const security = info.security || {};
  const rate = security.rateLimit || {};
  return pageShell({
    title: "health · literature-clock",
    tab: "/health",
    liveOn: info.ok,
    liveLabel: info.ok ? "alive" : "down",
    timeZone,
    body: `
      <div class="eyebrow">Diagnostics</div>
      <h2>Is the process up?<br><span>${info.ok ? "Yes." : "No."}</span></h2>
      <p class="muted">A 200 means the process is running. It does not mean a quote tool succeeded. Open <a href="/test">Test</a> for that.</p>
      ${stats([
        ["status", info.ok ? "alive" : "down", info.ok ? "ok" : "warn"],
        ["transport", info.transport || "http"],
        ["tools", info.tools],
        ["auth mode", security.authMode || "off", security.authMode === "off" ? "ok" : ""],
        ["api keys", security.activeKeyCount ?? 0],
        ["protocols", [security.protocols?.stdio && "stdio", security.protocols?.streamableHttp && "http", security.protocols?.sse && "sse"].filter(Boolean).join(", ") || "none"],
        ["rate limit", rate.enabled ? `${rate.limit}/${Math.round((rate.windowMs || 60000) / 1000)}s` : "off"],
      ])}
      ${info.cwd ? `<div class="cwd-line"><strong>Current working directory</strong><span class="mono">${esc(info.cwd)}</span></div>` : ""}
      <h3>Raw JSON</h3>
      <p class="muted"><a href="/health?format=json">/health?format=json</a></p>
      <pre>${esc(JSON.stringify(info, null, 2))}</pre>
    `,
  });
}

function trafficBlock(traffic) {
  if (!traffic) return `<p class="muted">No traffic yet this session.</p>`;
  const rows = (traffic.log || []).map((row) => `<tr class="${row.ok ? "" : "err-row"}"><td class="mono">${esc(row.tool)}</td><td>${row.ok ? "ok" : "fail"}</td><td>${esc(row.outcome)}</td></tr>`).join("");
  return `
    ${stats([
      ["rounds", traffic.rounds],
      ["calls", traffic.calls],
      ["ok", traffic.succeeded, "ok"],
      ["failed", traffic.failed, traffic.failed ? "warn" : ""],
      ["stopped", traffic.stopped || "—"],
    ])}
    <p class="muted">${esc(traffic.at || "")}${traffic.stopped ? ` · stopped: ${esc(traffic.stopped)}` : ""}</p>
    <div class="tbl-wrap"><table><thead><tr><th>Tool</th><th>Result</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function testPage(result, host, traffic = null, timeZone = "device", signedIn = false) {
  const base = `http://${host}`;
  const items = (result.steps || []).map((step) => `<li class="${step.ok ? "" : "fail"}"><strong>${esc(step.name)}</strong> — ${esc(step.detail)}</li>`).join("");
  const mcp = (id, name, args) => `curl -s -X POST '${base}/mcp' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -d '${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}'`;
  const rpc = (id, method, params) => `curl -s -X POST '${base}/mcp' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Accept: application/json, text/event-stream' \\\n  -d '${JSON.stringify({ jsonrpc: "2.0", id, method, params })}'`;
  return pageShell({
    title: "test · literature-clock",
    tab: "/test",
    timeZone,
    liveOn: result.ok,
    liveLabel: result.ok ? "smoke pass" : "smoke fail",
    body: `
      <div class="eyebrow">Diagnostics</div>
      <h2>Do the tools work?<br><span>${result.ok ? "Yes." : "Something failed."}</span></h2>
      ${pageTabs("test", [["tab-smoke", "Smoke test"], ["tab-traffic", "Traffic"], ["tab-curl", "curl commands"], ["tab-raw", "Raw JSON"]])}
      <div id="tab-smoke" class="pane active" data-group="test">
        <p class="muted">Read-only check: sources, a literature line, a voice line, and a mix sample.</p>
        <ul class="checklist">${items}</ul>
      </div>
      <div id="tab-traffic" class="pane" data-group="test">
        <p class="muted">Runs real reads, a bad clock time, an unknown schema, and one rejected credential. Quotes and settings stay as they are. The same rate limit applies, so a long run can stop early. Then open <a href="/log">Log</a> for counters, errors, and the trace. This needs a sign-in, or an API key on the request.</p>
        ${signedIn
          ? `<form method="post" action="/test/traffic" class="panel">
          <label class="field" style="max-width:160px">Rounds (1–20)
            <input type="number" name="rounds" min="1" max="20" value="5">
          </label>
          <p><button type="submit">Generate traffic</button></p>
        </form>`
          : `<p class="panel"><a href="/admin?next=${encodeURIComponent("/test#tab-traffic")}">Sign in</a> to generate traffic.</p>`}
        ${trafficBlock(traffic)}
      </div>
      <div id="tab-curl" class="pane" data-group="test">
        <p class="muted">Server: <code>${esc(base)}</code></p>
        <h3>Server</h3>
        ${curlBlock(`curl -s '${base}/health?format=json'`)}
        ${curlBlock(`curl -s '${base}/test?format=json'`)}
        <h3>Schema and discovery</h3>
        ${curlBlock(rpc(1, "tools/list", {}))}
        ${curlBlock(mcp(2, "describe_server", {}))}
        ${curlBlock(mcp(10, "list_schemas", {}))}
        ${curlBlock(mcp(11, "get_schema", { name: "quote" }))}
        ${curlBlock(mcp(12, "get_schema", { name: "get_quote" }))}
        ${curlBlock(`curl -s -X POST '${base}/test/traffic' \\\n  -H 'Authorization: Bearer YOUR_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"rounds":3}'`)}
        ${curlBlock(rpc(3, "resources/list", {}))}
        ${curlBlock(rpc(4, "resources/read", { uri: "quote://literature/09-05" }))}
        ${curlBlock(rpc(5, "prompts/list", {}))}
        <h3>Quotes</h3>
        ${curlBlock(mcp(6, "list_sources", {}))}
        ${curlBlock(mcp(7, "count_lines", { time: "09:05" }))}
        ${curlBlock(mcp(8, "get_quote", { time: "09:05", source: "literature" }))}
        ${curlBlock(mcp(9, "get_settings", {}))}
      </div>
      <div id="tab-raw" class="pane" data-group="test">
        <p class="muted"><a href="/test?format=json">/test?format=json</a></p>
        <pre>${esc(JSON.stringify(result, null, 2))}</pre>
      </div>
    `,
  });
}

export function toolsPage(authMode, timeZone = "device") {
  const rows = TOOL_CATALOG.map(([name, scope, purpose]) => `<tr>
    <td class="mono">${esc(name)}</td>
    <td>${esc(purpose)}</td>
    <td><span class="tag${scope === "read" ? " grey" : " coral"}">${esc(scope)}</span></td>
    <td>${tryButton(name)}</td>
  </tr>`).join("");
  const schemaRows = TOOL_CATALOG.map(([name, scope]) => `<tr>
    <td class="mono">${esc(name)}</td>
    <td><span class="tag grey">${esc(scope)}</span></td>
    <td>${esc(ARG_FIELDS[name] || "")}</td>
    <td><pre style="margin:0">${esc(JSON.stringify(DEFAULT_ARGS[name] || {}, null, 2))}</pre></td>
  </tr>`).join("");
  return pageShell({
    title: "tools · literature-clock",
    tab: "/tools",
    timeZone,
    liveOn: true,
    liveLabel: `${TOOL_CATALOG.length} tools`,
    body: `
      <div class="eyebrow">What the model sees</div>
      <h2>${TOOL_CATALOG.length} tools.<br><span>Run one, or read its schema.</span></h2>
      <p class="muted">Auth mode is <code>${esc(authMode)}</code>. Change it on <a href="/admin">Settings</a>. Run posts <code>tools/call</code> to <code>/mcp</code>. Schema loads <code>tools/list</code>.</p>
      ${pageTabs("tools", [["tools-list", "Tools"], ["tools-schema", "Schema"]])}
      <div id="tools-list" class="pane active" data-group="tools">
        ${searchRow("toolSearch", "toolTable", "Filter tools")}
        <div class="tbl-wrap"><table id="toolTable"><thead><tr><th>Tool</th><th>When to use</th><th>Scope</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>
      <div id="tools-schema" class="pane" data-group="tools">
        <p class="muted">Argument names the model sees. <code>list_schemas</code> then <code>get_schema</code> return the same shapes. The button below fetches the live JSON Schema from <code>tools/list</code>.</p>
        <p><button type="button" onclick="loadToolSchema()">Load tools/list schema</button></p>
        <div class="tbl-wrap"><table><thead><tr><th>Tool</th><th>Scope</th><th>Arguments</th><th>Example</th></tr></thead><tbody>${schemaRows}</tbody></table></div>
        <pre id="schemaOut">Schema not loaded.</pre>
      </div>
      ${toolTryModal()}
    `,
  });
}

export function logPage(snap, timeZone = "device") {
  const counters = snap.toolCounters || {};
  const errors = snap.errorLog || [];
  const trace = snap.callTrace || [];
  const audit = snap.adminEvents || [];
  const errorTotal = Object.values(counters).reduce((sum, row) => sum + (row.error || 0), 0);
  const deniedTotal = Object.values(counters).reduce((sum, row) => sum + (row.denied || 0), 0);
  const calls = Object.values(counters).reduce((sum, row) => sum + (row.success || 0) + (row.error || 0) + (row.denied || 0), 0);
  const counterRows = Object.entries(counters).map(([name, row]) => {
    const bad = (row.error || 0) + (row.denied || 0);
    return `<tr class="${bad ? "err-row" : ""}"><td class="mono">${esc(name)}</td><td>${row.success || 0}</td><td>${row.error || 0}</td><td>${row.denied || 0}</td><td>${(row.success || 0) + (row.error || 0) + (row.denied || 0)}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="muted">No calls yet. Run a tool on <a href="/tools">Tools</a>.</td></tr>`;
  const errorRows = errors.map((row, index) => {
    const id = `err-${index}`;
    return `<tr class="err-row"><td class="ts">${esc(clockOf(row.at))}</td><td class="mono">${esc(row.tool)}</td><td>${esc(row.principal || "—")}</td><td>${esc(String(row.error || "").slice(0, 140))} <button type="button" class="expand-btn" onclick="toggleDetail(this,'${id}')">▼ detail</button></td></tr>
      <tr id="${id}" class="detail-row"><td colspan="4" class="detail-cell"><pre>${esc(JSON.stringify(row, null, 2))}</pre></td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">No errors yet.</td></tr>`;
  const traceRows = trace.map((row) => `<tr class="${row.type === "success" ? "" : "err-row"}"><td class="ts">${esc(clockOf(row.at))}</td><td><span class="tag${row.type === "success" ? " grey" : " coral"}">${esc(row.type || "")}</span></td><td class="mono">${esc(row.tool)}</td><td>${esc(row.principal || "—")}</td></tr>`).join("")
    || `<tr><td colspan="4" class="muted">Trace is empty. Turn on call trace in <a href="/admin#set-security">Settings</a>, then run a tool.</td></tr>`;
  const auditRows = audit.map((row) => `<tr><td class="ts">${esc(clockOf(row.at))}</td><td class="mono">${esc(row.tool || "")}</td><td>${esc(row.outcome || "")}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted">No settings changes yet.</td></tr>`;
  return pageShell({
    title: "log · literature-clock",
    tab: "/log",
    timeZone,
    liveOn: errorTotal + deniedTotal === 0,
    liveLabel: errorTotal + deniedTotal === 0 ? "no errors" : `${errorTotal + deniedTotal} problems`,
    body: `
      <div class="eyebrow">Observability</div>
      <h2>Calls, errors, and traces.</h2>
      ${stats([
        ["total calls", calls],
        ["errors", errorTotal, errorTotal ? "warn" : ""],
        ["denied", deniedTotal, deniedTotal ? "warn" : ""],
        ["trace", trace.length, trace.length ? "" : "warn"],
        ["audit", audit.length],
      ])}
      <p class="muted">Refresh to update. The trace fills only while call trace is on. Export downloads the counters, errors, trace, audit trail, and each call’s caller (user, API key, or anonymous).</p>
      <p><a class="btn" href="/admin/export/log">Export log and trace</a></p>
      ${pageTabs("log", [["log-counters", "Counters"], ["log-errors", `Errors (${errors.length})`], ["log-trace", `Trace (${trace.length})`], ["log-audit", "Audit"]])}
      <div id="log-counters" class="pane active" data-group="log">
        ${searchRow("cntSearch", "cntTable", "Filter tools")}
        <div class="tbl-wrap"><table id="cntTable"><thead><tr><th>Tool</th><th>Success</th><th>Errors</th><th>Denied</th><th>Total</th></tr></thead><tbody>${counterRows}</tbody></table></div>
      </div>
      <div id="log-errors" class="pane" data-group="log">
        ${searchRow("errSearch", "errTable", "Search errors")}
        <div class="tbl-wrap"><table id="errTable"><thead><tr><th>Time</th><th>Tool</th><th>Caller</th><th>Error</th></tr></thead><tbody>${errorRows}</tbody></table></div>
      </div>
      <div id="log-trace" class="pane" data-group="log">
        <div class="tbl-wrap"><table id="traceTable"><thead><tr><th>Time</th><th>Result</th><th>Tool</th><th>Caller</th></tr></thead><tbody>${traceRows}</tbody></table></div>
      </div>
      <div id="log-audit" class="pane" data-group="log">
        <div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead><tbody>${auditRows}</tbody></table></div>
      </div>
    `,
  });
}

export function helpPage(host, timeZone = "device") {
  const base = `http://${host}`;
  return pageShell({
    title: "docs · literature-clock",
    tab: "/help",
    timeZone,
    liveOn: true,
    liveLabel: "docs",
    body: `
      <h2>Literature Clock MCP</h2>
      <p class="byline">${esc(AUTHOR.name)} · <a href="${esc(AUTHOR.url)}">${esc(AUTHOR.url)}</a> · <a href="${esc(AUTHOR.github)}">github.com/markusvankempen</a><br>${esc(AUTHOR.tagline)}</p>
      ${pageTabs("help", [["help-start", "Features"], ["help-author", "Author"], ["help-pages", "Pages"], ["help-tools", "Tools"]])}
      <div id="help-start" class="pane active" data-group="help">
        <div class="tbl-wrap"><table><thead><tr><th>Feature</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td class="mono">About</td><td>Package <code>literature-clock-mcp</code>. Registry name <code>io.github.markusvankempen/literature-clock-mcp</code>. A line for one clock minute, from Johannes Enevoldsen's literature collection, copyright-free books, or an original voice.</td></tr>
            <tr><td class="mono">Clock</td><td>Show, Another line, Random, and Read aloud.</td></tr>
            <tr><td class="mono">Sources</td><td>literature (default), books, mix, surprise, and the original voices.</td></tr>
            <tr><td class="mono">Tools</td><td>describe_server, list_sources, get_quote, count_lines, get_settings, update_settings, list_schemas, get_schema.</td></tr>
            <tr><td class="mono">Schema</td><td>list_schemas then get_schema, or tools/list. Run a tool and use Copy JSON or Open in a new tab.</td></tr>
            <tr><td class="mono">Resources</td><td>sources://list, quote://{source}/{hhmm}, and the seven prompts.</td></tr>
            <tr><td class="mono">Protocols</td><td>stdio, Streamable HTTP (<code>/mcp</code>), and legacy SSE (<code>/sse</code>). Each one can be turned off under Settings. One must stay on.</td></tr>
            <tr><td class="mono">Push</td><td>Optional. Settings → Push sends the current quote every 5, 10, 15, 30, or 60 minutes. Destinations are <code>GET /events</code>, open SSE sessions, open Streamable HTTP sessions, and an MQTT broker. Off until you choose an interval and a destination.</td></tr>
            <tr><td class="mono">Pages</td><td>Health, Test (smoke, and traffic after you sign in or send an API key), Tools, Settings, Log, and these docs. Settings can hide every page until sign-in.</td></tr>
            <tr><td class="mono">Access</td><td>Auth off, write, or all. Rate limit, per-tool enable and lock, API keys, and users. Log shows counters, errors, the call trace, and the audit trail. Settings and Log need a sign-in.</td></tr>
            <tr><td class="mono">ADMIN_PASSWORD</td><td>Environment variable for the Settings sign-in. On this laptop the default is <code>demo</code> / <code>demo</code> unless you set <code>ADMIN_USER</code> and <code>ADMIN_PASSWORD</code>. On a public bind (<code>HOST=0.0.0.0</code>, Render, or a container) the laptop password is off until <code>ADMIN_PASSWORD</code> is set. Restart after you change it. It is not saved in Settings.</td></tr>
            <tr><td class="mono">Backup</td><td>Settings → Backup downloads a JSON file of the clock, auth, protocols, schedule, tool gates, and saved users (password hashes only). Import restores that file. API keys, <code>ADMIN_PASSWORD</code>, and the MQTT password are not in the file. Log → Export log and trace downloads the counters, errors, trace, and audit trail.</td></tr>
            <tr><td class="mono">Home</td><td><a href="${esc(HOME)}">${esc(HOME)}</a></td></tr>
            <tr><td class="mono">Run</td><td><code>npm run http</code> from this package. Desk at <code>${esc(base)}</code>.</td></tr>
          </tbody>
        </table></div>
      </div>
      <div id="help-author" class="pane" data-group="help">
        <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>What it is</th></tr></thead>
          <tbody>
            <tr><td class="mono">Server</td><td><a href="${esc(AUTHOR.url)}">${esc(AUTHOR.name)}</a>. <a href="${esc(AUTHOR.github)}">github.com/markusvankempen</a>. ${esc(AUTHOR.tagline)}</td></tr>
            <tr><td class="mono">Home</td><td><a href="${esc(HOME)}">${esc(HOME)}</a>. <code>server.json</code> <code>websiteUrl</code> and <code>describe_server</code> <code>server.homepage</code> use this address.</td></tr>
            <tr><td class="mono">Registry</td><td>The MCP registry <code>server.json</code> has no author field. This server puts the project home in <code>websiteUrl</code>, the git repo in <code>repository</code>, and the person in <code>_meta["io.modelcontextprotocol.registry/publisher-provided"].author</code>.</td></tr>
            <tr><td class="mono">Literature</td><td><a href="${esc(LITERATURE.url)}">${esc(LITERATURE.work)}</a> by ${esc(LITERATURE.author)}. License <a href="${esc(LITERATURE.licenseUrl)}">${esc(LITERATURE.license)}</a>. The clock uses exact-minute copyright-free lines first, then that public collection.</td></tr>
            <tr><td class="mono">Books</td><td>Copyright-free lines bundled with the server. Their authors died in 1971 or earlier. The other sources are original voices written for this clock, not quotations from films or living authors.</td></tr>
          </tbody>
        </table></div>
      </div>
      <div id="help-pages" class="pane" data-group="help">
        <div class="tbl-wrap"><table><thead><tr><th>Page</th><th>What it does</th></tr></thead>
          <tbody>
            <tr><td class="mono">/</td><td>Clock. Another line, Random, Read.</td></tr>
            <tr><td class="mono">/health</td><td>Process is up. Not a tool test.</td></tr>
            <tr><td class="mono">/test</td><td>Smoke checklist, generated traffic, and curl commands.</td></tr>
            <tr><td class="mono">/tools</td><td>Run a tool. <code>list_schemas</code> and <code>get_schema</code> return the JSON Schema.</td></tr>
            <tr><td class="mono">/admin</td><td>Sign-in required. Clock defaults, auth, protocols, quote schedule, MQTT, hide-pages-until-sign-in, rate limit, gates, locks, keys, users, and settings export or import. Public binds need <code>ADMIN_PASSWORD</code>.</td></tr>
            <tr><td class="mono">/log</td><td>Sign-in required. Counters, errors, call trace, audit, and export.</td></tr>
            <tr><td class="mono">/events</td><td>Plain SSE for a custom client. Event name <code>quote</code>. Follows the same sign-in rule as <code>get_quote</code>.</td></tr>
            <tr><td class="mono">/mcp</td><td>Streamable HTTP. A scheduled quote arrives as <code>notifications/literature-clock/quote</code> when that destination is on.</td></tr>
            <tr><td class="mono">/sse</td><td>Legacy SSE. The same notification, on the open session, when that destination is on.</td></tr>
          </tbody>
        </table></div>
      </div>
      <div id="help-tools" class="pane" data-group="help">
        <div class="tbl-wrap"><table><thead><tr><th>Tool</th><th>What it does</th></tr></thead>
          <tbody>
            ${TOOL_CATALOG.map(([name, scope, purpose]) => `<tr><td class="mono">${esc(name)}</td><td>${esc(scope)}. ${esc(purpose)}</td></tr>`).join("")}
            <tr><td class="mono">Literature</td><td>Johannes Enevoldsen's collection, and the default. Books are the bundled copyright-free corpus.</td></tr>
          </tbody>
        </table></div>
      </div>
    `,
  });
}

export function loginPage({ error = "", disabled = false, next = "", timeZone = "device" } = {}) {
  return pageShell({
    title: "settings · literature-clock",
    tab: "/admin",
    liveOn: false,
    liveLabel: "signed out",
    timeZone,
    body: `
      <h2>Sign in.</h2>
      <p class="muted">${disabled ? "This bind is public. Set ADMIN_PASSWORD in the environment, then restart, before signing in. ADMIN_USER changes the name (default demo)." : "On this laptop the first sign-in is demo / demo, unless ADMIN_USER and ADMIN_PASSWORD are set. On a public address the laptop password is off until ADMIN_PASSWORD is set. More names are under Settings → Users."}</p>
      ${error ? `<p class="warn">${esc(error)}</p>` : ""}
      <form method="post" action="/admin/login" style="max-width:340px">
        <p class="field">Username<input name="username" autocomplete="username" required></p>
        <p class="field">Password<input name="password" type="password" autocomplete="current-password" required></p>
        ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ""}
        <button type="submit">Sign in</button>
      </form>
    `,
  });
}

export function adminPage({ security, settings, sources, issuedKey = "", notice = "" }) {
  const clock = settings.clock;
  const sourceOptions = sources.map((item) => `<option value="${esc(item.id)}"${item.id === clock.defaultSource ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  const zoneOptions = zoneChoices(clock.timeZone).map((zone) => `<option value="${esc(zone)}"${zone === clock.timeZone ? " selected" : ""}>${esc(zone === "device" ? "This machine" : zone)}</option>`).join("");
  const modes = (security.authModes || ["off", "write", "all"]).map((mode) => {
    const [title, detail] = AUTH_MODE_COPY[mode] || [mode, ""];
    return `<label class="mode${security.authMode === mode ? " on" : ""}"><input type="radio" name="authMode" value="${esc(mode)}"${security.authMode === mode ? " checked" : ""} style="width:auto;margin-top:3px"><span><b>${esc(title)}</b><span><code>${esc(mode)}</code> — ${esc(detail)}</span></span></label>`;
  }).join("");
  const gates = security.toolGates || {};
  const locks = security.toolAuthOverrides || {};
  const gateRows = Object.entries(gates).map(([name, enabled]) => {
    const gate = enabled
      ? `<form method="post" action="/admin/tool-gate" style="display:inline"><input type="hidden" name="tool" value="${esc(name)}"><input type="hidden" name="enabled" value="0"><button class="secondary" type="submit">Disable</button></form>`
      : `<form method="post" action="/admin/tool-gate" style="display:inline"><input type="hidden" name="tool" value="${esc(name)}"><input type="hidden" name="enabled" value="1"><button type="submit">Enable</button></form>`;
    const locked = locks[name] === true;
    const lock = name === "describe_server"
      ? `<span class="muted">stays open</span>`
      : locked
        ? `<span class="tag coral">🔒 auth required</span> <form method="post" action="/admin/tool-auth" style="display:inline"><input type="hidden" name="tool" value="${esc(name)}"><input type="hidden" name="requireAuth" value="0"><button class="secondary" type="submit">Remove lock</button></form>`
        : `<span class="tag grey">follows mode</span> <form method="post" action="/admin/tool-auth" style="display:inline"><input type="hidden" name="tool" value="${esc(name)}"><input type="hidden" name="requireAuth" value="1"><button type="submit">🔒 Lock</button></form>`;
    return `<tr><td class="mono">${esc(name)}</td><td>${enabled ? '<span class="tag">enabled</span>' : '<span class="tag coral">disabled</span>'} ${gate}</td><td>${lock}</td><td>${tryButton(name)}</td></tr>`;
  }).join("");
  const keyRows = (security.apiKeys || []).map((key) => `<tr>
    <td>${esc(key.label)}</td><td class="mono">${esc(key.prefix)}</td><td>${(key.scopes || []).map((scope) => `<span class="tag grey">${esc(scope)}</span>`).join(" ")}</td>
    <td>${key.active ? "active" : "revoked"}</td>
    <td>${key.active ? `<form method="post" action="/admin/keys/revoke"><input type="hidden" name="id" value="${esc(key.id)}"><button class="danger" type="submit">Revoke</button></form>` : ""}</td>
  </tr>`).join("") || `<tr><td colspan="5" class="muted">No keys yet.</td></tr>`;
  const userRows = (security.users || []).map((user) => {
    const kind = user.source === "admin" ? "built-in" : user.source === "env" ? "environment" : "saved";
    const remove = user.source === "saved"
      ? `<form method="post" action="/admin/users/delete"><input type="hidden" name="username" value="${esc(user.username)}"><button class="danger" type="submit">Remove</button></form>`
      : "";
    return `<tr><td class="mono">${esc(user.username)}</td><td>${(user.scopes || []).map((scope) => `<span class="tag grey">${esc(scope)}</span>`).join(" ")}</td><td>${esc(kind)}</td><td>${remove}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">No users yet.</td></tr>`;
  const rate = security.rateLimit || {};
  const push = settings.push || {};
  const dest = push.destinations || {};
  const mqtt = push.mqtt || {};
  const live = push.live || {};
  const intervalOptions = [
    [0, "Off"],
    [5, "Every 5 minutes"],
    [10, "Every 10 minutes"],
    [15, "Every 15 minutes"],
    [30, "Every 30 minutes"],
    [60, "Every 60 minutes"],
  ].map(([value, label]) => `<option value="${value}"${Number(push.everyMinutes) === value ? " selected" : ""}>${label}</option>`).join("");
  const lastPush = push.last?.at
    ? (push.last.ok ? `Last quote ${esc(push.last.time)} at ${esc(push.last.at)}.` : `Last attempt failed${push.last.time ? ` (${esc(push.last.time)})` : ""}: ${esc(push.last.error)}`)
    : "No quote sent yet.";
  return pageShell({
    title: "settings · literature-clock",
    tab: "/admin",
    liveOn: true,
    liveLabel: security.authMode || "off",
    timeZone: settings.clock,
    body: `
      <div class="page-head">
        <h2>Clock, access, and keys.</h2>
        <form method="post" action="/admin/logout"><button class="secondary" type="submit">Sign out</button></form>
      </div>
      ${notice ? `<p class="panel">${esc(notice)}</p>` : ""}
      ${issuedKey ? `<div class="secret"><strong>Copy this key now. It is not shown again.</strong><br><code>${esc(issuedKey)}</code><br>HTTP: Authorization: Bearer … · stdio: MCP_API_KEY</div>` : ""}
      ${pageTabs("set", [["set-clock", "Clock"], ["set-security", "Security"], ["set-protocols", "Protocols"], ["set-push", "Push"], ["set-gates", "Tool gates"], ["set-keys", "API keys"], ["set-users", "Users"], ["set-backup", "Backup"]])}
      <div id="set-clock" class="pane active" data-group="set">
        <form class="panel" method="post" action="/admin/settings">
          <h4>Defaults</h4>
          <p>Same values as <code>get_settings</code> and <code>update_settings</code>.</p>
          <div class="field-row">
            <label class="field">Default source<select name="defaultSource">${sourceOptions}</select></label>
            <label class="field">Lines per call<input name="defaultCount" type="number" min="1" max="8" value="${esc(clock.defaultCount)}"></label>
            <label class="field">Time zone<select name="timeZone">${zoneOptions}</select></label>
            <label class="field">Clock<select name="hourClock"><option value="24"${clock.hourClock !== "12" ? " selected" : ""}>24-hour</option><option value="12"${clock.hourClock === "12" ? " selected" : ""}>12-hour</option></select></label>
          </div>
          <button type="submit">Save clock</button>
        </form>
      </div>
      <div id="set-security" class="pane" data-group="set">
        <div class="panel">
          <h4>Admin password</h4>
          <p>The Settings and Log tabs need this sign-in. On this laptop the name and password are <code>demo</code> / <code>demo</code> unless the environment sets <code>ADMIN_USER</code> and <code>ADMIN_PASSWORD</code>.</p>
          <p>On a public bind — <code>HOST=0.0.0.0</code>, Render, or a container — the laptop password is turned off. Set <code>ADMIN_PASSWORD</code> before the process starts, then restart. The value is not stored in Settings and is not included in an export.</p>
        </div>
        <form class="panel" method="post" action="/admin/security">
          <h4>Auth mode</h4>
          <div class="modes">${modes}</div>
          <button type="submit">Apply mode</button>
        </form>
        <form class="panel" method="post" action="/admin/audit-mode">
          <h4>Call trace</h4>
          <p>When on, every tool call is listed on <a href="/log#log-trace">Log → Trace</a>.</p>
          <label><input type="checkbox" name="enabled" value="1"${security.auditMode ? " checked" : ""} style="width:auto"> Enable call trace</label>
          <button type="submit">Save</button>
        </form>
        <form class="panel" method="post" action="/admin/rate-limit">
          <h4>Rate limit</h4>
          <div class="field-row">
            <label class="field">Calls<input type="number" name="limit" min="1" value="${esc(rate.limit || 60)}"></label>
            <label class="field">Per seconds<input type="number" name="windowSeconds" min="1" value="${esc(Math.round((rate.windowMs || 60000) / 1000))}"></label>
            <label class="field">Enabled<br><input type="hidden" name="enabled" value="0"><input type="checkbox" name="enabled" value="1"${rate.enabled ? " checked" : ""} style="width:auto"></label>
          </div>
          <button type="submit">Save</button>
        </form>
      </div>
      <div id="set-protocols" class="pane" data-group="set">
        <form class="panel" method="post" action="/admin/protocols">
          <h4>Protocols</h4>
          <p>stdio is what Cursor and VS Code spawn. Streamable HTTP is <code>/mcp</code>, including Run on the Tools page. SSE is the older <code>/sse</code> route. Leave at least one on. The Settings page stays up either way.</p>
          <label><input type="hidden" name="stdio" value="0"><input type="checkbox" name="stdio" value="1"${security.protocols?.stdio !== false ? " checked" : ""} style="width:auto"> stdio</label><br>
          <label><input type="hidden" name="streamableHttp" value="0"><input type="checkbox" name="streamableHttp" value="1"${security.protocols?.streamableHttp !== false ? " checked" : ""} style="width:auto"> Streamable HTTP (<code>/mcp</code>)</label><br>
          <label><input type="hidden" name="sse" value="0"><input type="checkbox" name="sse" value="1"${security.protocols?.sse !== false ? " checked" : ""} style="width:auto"> Legacy SSE (<code>/sse</code>)</label>
          <p><button type="submit">Save protocols</button></p>
        </form>
        <form class="panel" method="post" action="/admin/ui-auth">
          <h4>Pages</h4>
          <p>When this is on, the clock, health, test, tools, docs, and log show this sign-in form until you are signed in. JSON replies and the MCP routes stay available.</p>
          <label><input type="hidden" name="enabled" value="0"><input type="checkbox" name="enabled" value="1"${security.uiRequireAuth ? " checked" : ""} style="width:auto"> Hide every page until sign-in</label>
          <p><button type="submit">Save</button></p>
        </form>
      </div>
      <div id="set-push" class="pane" data-group="set">
        <form class="panel" method="post" action="/admin/push">
          <h4>Schedule</h4>
          <p>Off until you pick an interval and at least one destination. The HTTP process sends the current quote from the saved source and time zone, on the matching minute (:00, :05, :10, and so on). A normal MCP chat does not print it. stdio does not run the schedule.</p>
          <label class="field">Interval<select name="pushEveryMinutes">${intervalOptions}</select></label>
          <p>
            <label><input type="hidden" name="pushEvents" value="0"><input type="checkbox" name="pushEvents" value="1"${dest.events ? " checked" : ""} style="width:auto"> Event stream (<code>GET /events</code>, event name <code>quote</code>)</label><br>
            <label><input type="hidden" name="pushSse" value="0"><input type="checkbox" name="pushSse" value="1"${dest.sse ? " checked" : ""} style="width:auto"> Legacy SSE sessions (<code>notifications/literature-clock/quote</code>)</label><br>
            <label><input type="hidden" name="pushHttp" value="0"><input type="checkbox" name="pushHttp" value="1"${dest.streamableHttp ? " checked" : ""} style="width:auto"> Streamable HTTP sessions (the same notification)</label>
          </p>
          <h4>MQTT broker</h4>
          <p>Publishes the same JSON. The password is saved on this machine and is not shown again.</p>
          <label><input type="hidden" name="mqttEnabled" value="0"><input type="checkbox" name="mqttEnabled" value="1"${dest.mqtt ? " checked" : ""} style="width:auto"> Publish to MQTT</label>
          <div class="field-row">
            <label class="field">Broker URL<input name="mqttUrl" value="${esc(mqtt.url || "mqtt://127.0.0.1:1883")}" placeholder="mqtt://127.0.0.1:1883"></label>
            <label class="field">Topic<input name="mqttTopic" value="${esc(mqtt.topic || "literature-clock/quote")}"></label>
            <label class="field">Client id<input name="mqttClientId" value="${esc(mqtt.clientId || "literature-clock")}"></label>
            <label class="field">Username<input name="mqttUsername" value="${esc(mqtt.username || "")}" autocomplete="off"></label>
            <label class="field">Password<input name="mqttPassword" type="password" value="" placeholder="${mqtt.passwordSet ? "Saved. Leave blank to keep it." : "Optional"}" autocomplete="new-password"></label>
          </div>
          <label><input type="checkbox" name="mqttClearPassword" value="1" style="width:auto"> Clear the saved password</label>
          <p><button type="submit">Save schedule</button></p>
        </form>
        <div class="panel">
          <p>${lastPush}</p>
          <p class="muted">Listening now: event stream ${esc(live.events || 0)}, SSE ${esc(live.sse || 0)}, Streamable HTTP ${esc(live.streamableHttp || 0)}.</p>
          <form method="post" action="/admin/push-now"><button class="secondary" type="submit">Push a quote now</button></form>
          <p class="muted">Uses the saved destinations, not unsaved edits in the form above.</p>
        </div>
      </div>
      <div id="set-gates" class="pane" data-group="set">
        <p class="muted">Disable hides a tool. Lock forces a credential even when auth mode is off. describe_server stays available and stays open.</p>
        <div class="tbl-wrap"><table><thead><tr><th>Tool</th><th>Availability</th><th>Auth</th><th></th></tr></thead><tbody>${gateRows}</tbody></table></div>
      </div>
      <div id="set-keys" class="pane" data-group="set">
        <form class="panel" method="post" action="/admin/keys">
          <h4>Issue a key</h4>
          <div class="field-row">
            <label class="field">Label<input name="label" placeholder="my agent"></label>
            <label class="field">Scopes<input name="scopes" value="read,write"></label>
          </div>
          <button type="submit">Issue key</button>
        </form>
        <div class="tbl-wrap"><table><thead><tr><th>Label</th><th>Prefix</th><th>Scopes</th><th></th><th></th></tr></thead><tbody>${keyRows}</tbody></table></div>
      </div>
      <div id="set-users" class="pane" data-group="set">
        <form class="panel" method="post" action="/admin/users">
          <h4>Create a user</h4>
          <p>Saving an existing name sets a new password. Admin can sign in on this page. Read and write are for tool calls. Passwords are stored as hashes.</p>
          <div class="field-row">
            <label class="field">Username<input name="username" autocomplete="off" required></label>
            <label class="field">Password<input name="password" type="password" autocomplete="new-password" required></label>
          </div>
          <label><input type="checkbox" name="scopes" value="read" checked style="width:auto"> read</label>
          <label><input type="checkbox" name="scopes" value="write" checked style="width:auto"> write</label>
          <label><input type="checkbox" name="scopes" value="admin" checked style="width:auto"> admin</label>
          <p><button type="submit">Save user</button></p>
        </form>
        <div class="tbl-wrap"><table><thead><tr><th>User</th><th>Scopes</th><th></th><th></th></tr></thead><tbody>${userRows}</tbody></table></div>
      </div>
      <div id="set-backup" class="pane" data-group="set">
        <div class="panel">
          <h4>Export settings</h4>
          <p>Downloads the clock, auth mode, rate limit, protocols, page lock, quote schedule, MQTT broker fields, tool gates, and saved users. Passwords in that file are hashes. API keys, <code>ADMIN_PASSWORD</code>, and the MQTT password are left out. The MQTT password already saved here stays in place on import.</p>
          <p><a class="btn" href="/admin/export/settings">Export settings</a></p>
        </div>
        <form class="panel" method="post" action="/admin/import">
          <h4>Import settings</h4>
          <p>Replaces the saved settings with a file from Export. Saved users in the file replace the saved users on this machine. The built-in admin is unchanged.</p>
          <label class="field">Settings file<input type="file" accept="application/json,.json" onchange="readSettingsFile(this)"></label>
          <label class="field">Or paste the JSON<textarea id="settings-import" name="document" rows="8" required placeholder='{"kind":"literature-clock-settings","version":1}'></textarea></label>
          <button type="submit">Import settings</button>
        </form>
        <script>
          function readSettingsFile(input) {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              var box = document.getElementById("settings-import");
              if (box) box.value = String(reader.result || "");
            };
            reader.readAsText(file);
          }
        </script>
      </div>
      ${toolTryModal()}
    `,
  });
}
