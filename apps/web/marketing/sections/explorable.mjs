// The explorable run: the hero's live bench embedded in a page section, driven by a
// timeline instead of scroll. Drag or hover the chart (or press play) and the bench lives
// through that exact recorded second; the readout beside it shows every component's numbers.
// Renders only while visible, and only redraws the parts when the second changes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import { turnScript } from "../scripts/inline-kit.mjs";
import { scene, PAGE_HELPERS } from "../object/scene.mjs";
import { FILM } from "../object/film.mjs";
import { RUN, series, lineChart } from "./site.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = scene({ W: 540, H: 960, radius: FILM.radius * 1.05, pad: 0 });
const source = (file) => readFileSync(file, "utf8").replace(/^export /gm, "");
const film = source(join(HERE, "..", "object", "film.mjs"));
const timeline = source(join(HERE, "..", "motion", "timeline.mjs"));
const W = 960, H = 600;

export const exploreCss = `
.explore { display: grid; grid-template-columns: 8fr 4fr; gap: 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
.ex-stage { position: relative; aspect-ratio: ${W} / ${H}; border-right: 1px solid var(--rule); }
.ex-stage .mo { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; --mo-w: 100%; --mo-h: 100%; }
.ex-stage .mo .mo-bg, .ex-stage .mo .mo-vignette { display: none; }
.ex-stage .iso-stage, .ex-stage .iso-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ex-stage .hint { position: absolute; left: 0; bottom: 14px; z-index: 2; }
.ex-tag { position: absolute; z-index: 2; transform: translate(-50%, 0); font: 500 11px/1 GeistMono, monospace; letter-spacing: .06em; color: var(--ink2); padding: 4px 7px; border-radius: 6px; background: var(--bg); border: 1px solid var(--rule); white-space: nowrap; pointer-events: none; }
.ex-tag.dead { color: var(--dead); border-color: currentColor; }
.ex-side { padding: 28px 0 28px 32px; display: grid; align-content: start; gap: 22px; }
.ex-now { display: grid; gap: 6px; }
.ex-now b { font: 500 56px/1 GeistMono, ui-monospace, monospace; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.ex-now b small { font-size: 18px; color: var(--ink3); margin-left: 4px; letter-spacing: 0; }
.ex-ev { min-height: 3.2em; font-size: 15.5px; color: var(--ink2); }
.ex-ev strong { color: var(--ink); font-weight: 600; }
.ex-table { width: 100%; border-collapse: collapse; font: 400 13px/1 GeistMono, monospace; font-variant-numeric: tabular-nums; }
.ex-table th { text-align: right; font-weight: 500; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); padding: 0 0 10px; border-bottom: 1px solid var(--rule2); }
.ex-table th:first-child, .ex-table td:first-child { text-align: left; }
.ex-table td { text-align: right; padding: 12px 0; border-bottom: 1px solid var(--rule); color: var(--ink2); }
.ex-table td:first-child { color: var(--ink); }
.ex-table td.st { display: flex; justify-content: flex-end; align-items: center; gap: 7px; color: var(--ink); }
.ex-table td.st i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.ex-ctl { display: flex; align-items: center; gap: 16px; padding: 22px 0 6px; }
.ex-play { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; height: 40px; padding: 0 16px; border: 1px solid var(--rule2); border-radius: 999px; font-weight: 500; font-size: 14px; }
.ex-play:hover { border-color: var(--ink3); }
.ex-play i { width: 0; height: 0; border-left: 8px solid currentColor; border-top: 5px solid transparent; border-bottom: 5px solid transparent; }
.ex-play[aria-pressed="true"] i { width: 8px; height: 10px; border: 0; border-left: 3px solid currentColor; border-right: 3px solid currentColor; box-sizing: border-box; }
.ex-range { flex: 1; accent-color: var(--accent); }
.ex-chart { padding-top: 10px; }
.ex-chart .chart svg { cursor: ew-resize; }
.ex-chart .chart .now { stroke: var(--accent); stroke-width: 1.5; }
@media (max-width: 980px) { .explore { grid-template-columns: 1fr; } .ex-stage { border-right: 0; border-bottom: 1px solid var(--rule); } .ex-side { padding: 24px 0; } }
`;

const stage = `<div class="iso-stage iso-turn">${k.figureSvg({ width: W, height: H, label: "The load bench, playing the recorded run second by second", body: "" })}<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer under" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>${S.out.layerSvg("live", { width: W, height: H })}<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer fx" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg></div>`;

export const exploreHtml = (start = 60) => `<div class="explore" data-start="${start}">
  <div class="ex-stage"><div class="iso mo" data-theme="light">${stage}<div class="mo-flash"></div></div><span class="hint mono">Live · drag the timeline below</span></div>
  <aside class="ex-side" aria-live="polite">
    <div class="ex-now"><span class="mono">Recorded second</span><b><span class="ex-s">${start}</span><small>/ ${RUN.points.length}</small></b></div>
    <p class="ex-ev"></p>
    <table class="ex-table"><thead><tr><th>Part</th><th>rps</th><th>cpu</th><th>State</th></tr></thead><tbody>
      ${["lb", "app-1", "app-2", "db"].map((id) => `<tr data-id="${id}"><td>${id}</td><td class="r">–</td><td class="c">–</td><td class="st"><i></i><span></span></td></tr>`).join("")}
    </tbody></table>
  </aside>
</div>
<div class="ex-ctl"><button class="ex-play" type="button" aria-pressed="false"><i></i><span>Play</span></button><input class="ex-range" type="range" min="1" max="${RUN.points.length}" step="1" value="${start}" aria-label="Recorded second"><span class="mono">${RUN.points.length} s recorded</span></div>
<div class="ex-chart">${lineChart({ id: "ex-cpu", height: 240, series: [
  { label: "app-1", values: series("app-1", 1), color: "var(--accent)" },
  { label: "db", values: series("db", 1), color: "var(--ink)" },
  { label: "lb", values: series("lb", 1), color: "var(--ink3)" },
] })}</div>`;

export const miniHtml = (start = 55) => `<div class="ex-mini" data-start="${start}"><div class="ex-stage"><div class="iso mo" data-theme="light">${stage}<div class="mo-flash"></div></div></div><div class="ex-mini-now mono">second <b class="ex-s">${start}</b> / ${RUN.points.length}</div></div>`;
export const miniCss = `
.ex-mini { position: relative; }
.ex-mini .ex-stage { position: relative; aspect-ratio: ${W} / ${H}; }
.ex-mini .ex-stage .mo { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; --mo-w: 100%; --mo-h: 100%; }
.ex-mini .mo .mo-bg, .ex-mini .mo .mo-vignette { display: none; }
.ex-mini .iso-stage, .ex-mini .iso-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ex-mini-now { position: absolute; right: 0; bottom: 0; } .ex-mini-now b { color: var(--ink); font-weight: 500; }
.ex-tag { position: absolute; z-index: 2; transform: translate(-50%, 0); font: 500 11px/1 GeistMono, monospace; letter-spacing: .06em; color: var(--ink2); padding: 4px 7px; border-radius: 6px; background: var(--bg); border: 1px solid var(--rule); white-space: nowrap; pointer-events: none; }
.ex-tag.dead { color: var(--dead); border-color: currentColor; }`;

// what the recording says happens at each second, in plain words
const EVENTS = `[[1, 59, "<strong>Two servers share the load.</strong> Traffic ramps up; app-1 and app-2 each take half."], [60, 60, "<strong>app-2 crashes.</strong> Its process stops at this second."], [61, 61, "<strong>app-1 takes everything.</strong> Its traffic doubles in one second."], [62, 62, "<strong>The database runs hot.</strong>"], [63, 89, "<strong>app-1 is saturated.</strong> One server can't carry what two did."], [90, 90, "<strong>End of the recording.</strong> app-2 never came back in time."]]`;

const DATA = { origin: S.obj.root.origin, turn: S.out.data, explode: S.obj.explode, basis: S.basis, anchors: S.obj.anchors, W, H, ratio: "live", counts: { parts: S.out.report.parts } };
const LIVE = `(() => {
const DATA = ${JSON.stringify(DATA)};
${PAGE_HELPERS}
${film}
${timeline}
const box = document.querySelector(".explore, .ex-mini"); if (!box) return;
const stage = box.querySelector(".iso-stage"), svgs = [...stage.querySelectorAll("svg")], moRoot = box.querySelector(".mo");
const ctl = TURN.mount(stage, DATA.turn, {});
const { R: BR, D: BD, k: BK, origin: BO } = DATA.basis;
const apply = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2], M[3] * p[0] + M[4] * p[1] + M[5] * p[2], M[6] * p[0] + M[7] * p[1] + M[8] * p[2]];
const screenOf = (w) => [BO[0] + (w[0] * BR[0] + w[1] * BR[1] + w[2] * BR[2]) * BK, BO[1] + (w[0] * BD[0] + w[1] * BD[1] + w[2] * BD[2]) * BK];
const anchor = (a) => (typeof a === "string" ? DATA.anchors[a] : a);
const about = (M, p) => { const O = DATA.origin; const r = apply(M, [p[0] - O[0], p[1] - O[1], p[2] - O[2]]); return [r[0] + O[0], r[1] + O[1], r[2] + O[2]]; };
function viewOf(s) {
  const M = orient(s.yaw, s.pitch, s.roll);
  const fa = anchor(s.focus.a), fb = anchor(s.focus.b);
  const local = fa.map((v, i) => v + (fb[i] - v) * s.focus.e);
  const [cx, cy] = screenOf(about(M, local));
  const w = DATA.W / s.zoom, h = DATA.H / s.zoom;
  return { M, x: cx + s.panX / s.zoom - w / 2, y: cy + s.panY / s.zoom - h / 2, w, h };
}
// one fixed camera: the assembled bench, lit, centred in the frame
const T0 = ASSEMBLY_END + 0.6;
const base = at(T0);
const cam0 = { ...base, yaw: -28, pitch: 30, roll: 0, panX: 0, panY: 0, zoom: 1, apart: 0, build: 1, t: T0 };
// frame the whole bench: fit the projected module anchors into the box with a margin
const fit = (() => {
  const M = orient(cam0.yaw, cam0.pitch, cam0.roll), pts = Object.values(DATA.anchors).map((a) => screenOf(about(M, a)));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: (x1 - x0) * 1.32, h: (y1 - y0) * 1.42 };
})();
const cam = cam0;
const aspect = DATA.W / DATA.H, vw = Math.max(fit.w, fit.h * aspect), vh = vw / aspect;
const view = { M: orient(cam.yaw, cam.pitch, cam.roll), x: fit.cx - vw / 2, y: fit.cy - vh / 2 + vh * 0.03, w: vw, h: vh };
// a name tag under each module, placed at its projected ground point
const tags = {};
for (const id of ["dns", "lb", "app-1", "app-2", "db"]) {
  const g = DATA.anchors["gnd." + id]; if (!g) continue;
  const [sx, sy] = screenOf(about(view.M, g)), el = document.createElement("span");
  el.className = "ex-tag"; el.textContent = id;
  el.style.left = ((sx - view.x) / view.w * 100).toFixed(2) + "%"; el.style.top = ((sy - view.y) / view.h * 100 + 2.5).toFixed(2) + "%";
  box.querySelector(".ex-stage").appendChild(el); tags[id] = el;
}
for (const svg of svgs) svg.setAttribute("viewBox", [view.x, view.y, view.w, view.h].map((v) => v.toFixed(2)).join(" "));
const EVENTS = ${EVENTS};
const COLORS = ["var(--ok)", "var(--hot)", "var(--hot)", "var(--dead)"], NAMES = ["healthy", "under pressure", "saturated", "failed"];
const rows = Object.fromEntries([...box.querySelectorAll("tr[data-id]")].map((r) => [r.dataset.id, r]));
const secEl = box.querySelector(".ex-s"), evEl = box.querySelector(".ex-ev");
// the controls are optional: the full explorer has a slider, play and a chart; the mini one is driven by the page
const range = document.querySelector(".ex-range"), play = document.querySelector(".ex-play");
const chart = document.getElementById("ex-cpu"), chartSvg = chart && chart.querySelector("svg");
const n = RUN.points.length, L = chart ? +chart.dataset.l : 0, R = chart ? +chart.dataset.r : 0, CW = chart ? +chart.dataset.w : 0;
let nowLine = null;
if (chartSvg) { nowLine = document.createElementNS("http://www.w3.org/2000/svg", "line"); nowLine.setAttribute("class", "now"); const xh = chartSvg.querySelector(".xh"); nowLine.setAttribute("y1", xh.getAttribute("y1")); nowLine.setAttribute("y2", xh.getAttribute("y2")); chartSvg.appendChild(nowLine); }
let stopAt = n, onDone = null, rate = 4;
let sec = +box.dataset.start, partsSec = -1, visible = false, playing = false, lastT = 0;
const mode = () => document.documentElement.dataset.mode === "dark" ? "dark" : "light";
function setSec(v) {
  sec = Math.max(1, Math.min(n, v));
  const s = Math.floor(sec), st = stationsAt(s);
  if (secEl) secEl.textContent = s; if (range) range.value = s;
  if (nowLine) { const px = L + ((s - 1) / (n - 1)) * (CW - L - R); nowLine.setAttribute("x1", px); nowLine.setAttribute("x2", px); }
  const ev = EVENTS.find((e) => s >= e[0] && s <= e[1]); if (evEl) evEl.innerHTML = ev ? ev[2] : "";
  for (const id in tags) tags[id].classList.toggle("dead", !!st[id] && st[id].dead);
  for (const id in rows) { const x = st[id], r = rows[id]; r.querySelector(".r").textContent = x.dead ? "–" : x.rps; r.querySelector(".c").textContent = x.dead ? "–" : Math.round(x.cpu) + "%"; const c = r.querySelector(".st"); c.style.setProperty("--c", COLORS[x.h]); c.querySelector("span").textContent = NAMES[x.h]; }
  if (!visible) draw(performance.now());
}
function draw(now) {
  const s = { ...cam, sec, clock: now / 1000, view };
  const whole = Math.floor(sec);
  if (whole !== partsSec) { ctl.set({ root: { R: view.M }, ...featureValues(s, explodeValues(0)) }, { detail: 1 }); partsSec = whole; }
  paint(s, stage, null);
  // the page's mode owns the colours, not the film's light switch
  const m = mode();
  if (moRoot.dataset.theme !== m) moRoot.dataset.theme = m;
  if (PAINT.under && PAINT.under.dataset.theme !== m) PAINT.under.dataset.theme = m;
  if (PAINT.fx && PAINT.fx.dataset.theme !== m) PAINT.fx.dataset.theme = m;
}
function loop(now) {
  if (!visible) return;
  if (playing) { const dt = Math.min(0.1, (now - lastT) / 1000); setSec(Math.min(stopAt, sec + dt * rate)); if (sec >= stopAt) { playing = false; if (play) { play.setAttribute("aria-pressed", "false"); play.querySelector("span").textContent = "Replay"; } const f = onDone; onDone = null; if (f) f(); } }
  lastT = now; draw(now); requestAnimationFrame(loop);
}
new IntersectionObserver((es) => { const v = es[0].isIntersecting; if (v && !visible) { visible = true; lastT = performance.now(); requestAnimationFrame(loop); } visible = v; }).observe(box);
if (range) range.addEventListener("input", () => { playing = false; play.setAttribute("aria-pressed", "false"); setSec(+range.value); });
const fromPointer = (e) => { const r = chartSvg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * CW; return 1 + Math.round(((vx - L) / (CW - L - R)) * (n - 1)); };
let dragging = false;
if (chartSvg) {
  chartSvg.addEventListener("pointerdown", (e) => { dragging = true; playing = false; chartSvg.setPointerCapture(e.pointerId); setSec(fromPointer(e)); });
  chartSvg.addEventListener("pointermove", (e) => { if (dragging) setSec(fromPointer(e)); });
  chartSvg.addEventListener("pointerup", () => { dragging = false; });
}
if (play) play.addEventListener("click", () => { playing = !playing; stopAt = n; rate = 4; if (playing && sec >= n) setSec(40); play.setAttribute("aria-pressed", String(playing)); play.querySelector("span").textContent = playing ? "Pause" : "Play"; lastT = performance.now(); });
// the page can drive the bench: jump to a second, or play from one second to another
window.IFBench = { setSec, playTo(from, to, r = 4, done = null) { setSec(from); stopAt = to; rate = r; onDone = done; playing = true; lastT = performance.now(); }, get sec() { return sec; } };
setSec(sec); draw(performance.now());
})();`;

export const exploreJs = `<script>${(turnScript() + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script>`;
