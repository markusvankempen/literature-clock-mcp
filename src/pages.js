/** Clock page. Same header, type, and width as the rest of the desk. */
import { pageShell } from "./dashboard.js";
import { formatClock } from "./prefs.js";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

export function clockPage({ quote, settings, sources, source, time }) {
  const line = quote.lines?.[0];
  let shown = line ? esc(line.text) : "";
  if (line?.time_phrase) {
    shown = shown.replace(esc(line.time_phrase), `<span class="time">${esc(line.time_phrase)}</span>`);
  }
  const hourClock = settings.clock?.hourClock === "12" ? "12" : "24";
  const shownTime = formatClock(time || quote.time || "", hourClock);
  const options = sources.map((item) => `<option value="${esc(item.id)}"${item.id === source ? " selected" : ""}>${esc(item.label)}</option>`).join("");
  const body = line
    ? `<p class="quote">${shown}</p>
       <p class="muted clock-meta">${esc(line.citation)}${line.note ? ` — ${esc(line.note)}` : ""}</p>
       <p class="muted clock-meta">${esc(shownTime)} · ${esc(line.source_label)}</p>`
    : `<p class="quote">No line for this minute.</p>`;
  return pageShell({
    title: "Literature Clock",
    tab: "/",
    timeZone: settings.clock,
    body: `
      <div class="clock-sheet">
        <div class="eyebrow">This minute</div>
        ${body}
        <form class="panel" method="get" action="/">
          <div class="field-row">
            <label class="field" for="source">Source<select id="source" name="source">${options}</select></label>
            <label class="field" for="time">Time<input id="time" name="time" value="${esc(shownTime)}" placeholder="${hourClock === "12" ? "h:mm AM or now" : "HH:MM or now"}"></label>
          </div>
          <input type="hidden" name="avoid" value="${esc(line?.text || "")}">
          <div class="row">
            <button type="submit">Show</button>
            <button type="submit" name="another" value="1">Another line</button>
            <button type="submit" name="random" value="1">Random</button>
            <button type="button" class="secondary" id="read"${line ? "" : " disabled"}>Read</button>
          </div>
        </form>
        <p class="muted">Source ${esc(settings.clock.defaultSource)}, ${esc(settings.clock.timeZone === "device" ? "this machine" : settings.clock.timeZone)}, ${hourClock}-hour.</p>
      </div>
      <script>
        document.getElementById("read")?.addEventListener("click", () => {
          const text = ${JSON.stringify(line ? [line.text, line.citation].filter(Boolean).join(". ") : "")};
          if (!text || !window.speechSynthesis) return;
          window.speechSynthesis.cancel();
          const utter = new SpeechSynthesisUtterance(text);
          utter.lang = "en";
          window.speechSynthesis.speak(utter);
        });
      </script>
    `,
  });
}
