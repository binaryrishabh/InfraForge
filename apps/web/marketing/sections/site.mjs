// Shared pieces of the InfraForge site (system A, "Ivory & Black"): tokens, type,
// the bar, sections, figures, tables, questions, footer and the recorded-run charts.
// Rules: flat colour only (no gradients, no glass, no glows), hairline rules, lots of
// air, the hero's type sizes, every number read from the recording.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontUrl } from "../assets.mjs";
import * as k from "../kit/iso-kit.mjs";
import { scene } from "../object/scene.mjs";
import { FILM } from "../object/film.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = scene({ W: 540, H: 960, radius: FILM.radius * 1.05, pad: 0 });
const look = readFileSync(join(HERE, "../motion/look.css"), "utf8");
// a still is a quiet frame: transient effects (sparks, rings, arcs) are dropped
export const still = (name) => readFileSync(join(HERE, `${name}.stage.html`), "utf8").replace(/(<svg[^>]*class="iso-svg iso-layer fx"[^>]*>)[\s\S]*?(<\/svg>)/, "$1$2");

// ---- the recording ----
export const RUN = JSON.parse(readFileSync(join(HERE, "../data/sampleRunRps.json"), "utf8"));
export const IDS = RUN.stations.map((s) => s.id);
export const at = (t) => Object.fromEntries(IDS.map((id, i) => { const [h, cpu, rps, mem] = RUN.points.find((p) => p.t === t).resources[i]; return [id, { h, cpu, rps, mem }]; }));
export const series = (id, field) => RUN.points.map((p) => p.resources[IDS.indexOf(id)][field]);
export const firstAt = (id, test) => RUN.points.find((p) => test(p.resources[IDS.indexOf(id)]))?.t;
export const fmt = (n) => (Math.round(n * 10) / 10).toString();
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ---- styles ----
export const css = (accent) => `
@font-face { font-family: InterTight; src: url(${fontUrl("inter-tight-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; font-display: swap; }
@font-face { font-family: GeistMono; src: url(${fontUrl("geist-mono-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; font-display: swap; }
${k.ISO_CSS}
${S.out.css}
${look}
:root, [data-mode="light"] { --bg: #f4efe6; --band: #ede6da; --card: #fbf8f2; --ink: #1a1714; --ink2: #5f5850; --ink3: #8f877c; --rule: #ddd5c8; --rule2: #cfc6b8;
  --accent: ${accent.light}; --accent-ink: ${accent.lightInk}; --on-accent: ${accent.onLight}; --hot: #b9581f; --dead: #c0423b; --ok: #2f7f59; color-scheme: light; }
[data-mode="dark"] { --bg: #080808; --band: #0f0f0f; --card: #131313; --ink: #f2eee8; --ink2: #aaa49c; --ink3: #75706a; --rule: #222120; --rule2: #2e2c2a;
  --accent: ${accent.dark}; --accent-ink: ${accent.dark}; --on-accent: #140d07; --hot: #ec8a4c; --dead: #ef6158; --ok: #4fbf8a; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
html, body { margin: 0; background: var(--bg); }
body { color: var(--ink); font: 400 17px/1.65 InterTight, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
a { color: inherit; text-decoration: none; }
p { margin: 0; }
.wrap { max-width: 1200px; margin: 0 auto; padding-left: max(24px, 4vw); padding-right: max(24px, 4vw); }
.mono { font: 500 11.5px/1.3 GeistMono, ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); }
.lead { font-size: 20px; line-height: 1.6; color: var(--ink2); max-width: 36em; }
.prose { display: grid; gap: 22px; color: var(--ink2); max-width: 38em; }
.prose b { color: var(--ink); font-weight: 500; }

/* bar: solid, quiet, sticky */
.bar { position: sticky; top: 0; z-index: 20; background: var(--bg); border-bottom: 1px solid var(--rule); }
.bar .wrap { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: 68px; }
.mark { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 16px; letter-spacing: -.01em; }
.mark i { width: 17px; height: 17px; border: 1.5px solid currentColor; border-radius: 5px; position: relative; }
.mark i::after { content: ""; position: absolute; left: 3px; top: 3px; width: 5px; height: 5px; border-radius: 50%; background: #ee8a3c; }
.mark span { color: var(--ink3); font-weight: 400; }
.nav { display: flex; gap: 30px; font-size: 14.5px; color: var(--ink2); }
.nav a:hover, .nav a.on { color: var(--ink); }
.right { justify-self: end; display: flex; gap: 16px; align-items: center; font-size: 14.5px; }
.mode { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; color: var(--ink2); font: 500 11px/1 GeistMono, monospace; letter-spacing: .1em; text-transform: uppercase; }
.mode i { width: 26px; height: 14px; border-radius: 999px; border: 1px solid var(--rule2); position: relative; }
.mode i::after { content: ""; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--ink); transition: transform .25s; }
[data-mode="dark"] .mode i::after { transform: translateX(12px); }

/* buttons: flat */
.btns { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 10px; height: 46px; padding: 0 20px; border-radius: 999px; font-weight: 500; font-size: 15px; border: 1px solid var(--rule2); color: var(--ink); background: transparent; transition: background .2s, border-color .2s; }
.btn:hover { border-color: var(--ink3); }
.btn.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.btn.primary:hover { filter: brightness(1.05); }
.btn small { font: 400 11.5px/1 GeistMono, monospace; opacity: .7; }
.link { font-weight: 500; border-bottom: 1px solid var(--rule2); padding-bottom: 2px; }
.link:hover { border-color: var(--ink); }

/* opening */
.open { border-bottom: 1px solid var(--rule); }
.open .wrap { display: grid; grid-template-columns: 5fr 7fr; gap: 3vw; align-items: center; min-height: calc(100vh - 68px); min-height: calc(100dvh - 68px); padding-top: 72px; padding-bottom: 72px; }
.open h1 { margin: 22px 0 0; font-weight: 600; font-size: clamp(36px, 4.1vw, 58px); line-height: 1.06; letter-spacing: -.032em; text-wrap: balance; }
.open .lead { margin-top: 24px; }
.open .btns { margin-top: 36px; }
.open .meta { margin-top: 44px; display: flex; gap: 28px; flex-wrap: wrap; }
.open .meta div { display: grid; gap: 4px; }
.open .meta b { font-weight: 500; font-size: 15px; }
.figure-bench { position: relative; aspect-ratio: 1.38; }
.figure-bench .iso, .figure-bench .iso-stage, .figure-bench .iso-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.figure-bench figcaption { position: absolute; left: 0; bottom: -6px; }

/* sections */
.sec { padding-top: 120px; padding-bottom: 120px; border-bottom: 1px solid var(--rule); }
.sec.band { background: var(--band); }
.sec-head { display: grid; grid-template-columns: 4fr 8fr; gap: 4vw; align-items: start; margin-bottom: 60px; }
.sec-head h2 { margin: 18px 0 0; font-weight: 600; font-size: clamp(28px, 2.9vw, 42px); line-height: 1.12; letter-spacing: -.025em; text-wrap: balance; }
.sec-head .side { padding-top: 34px; display: grid; gap: 22px; }
.sec-head .side .prose { font-size: 17px; }
.sec-body.split { display: grid; grid-template-columns: 4fr 8fr; gap: 4vw; }

/* numbered rows */
.rows { border-top: 1px solid var(--rule); }
.row { display: grid; grid-template-columns: 4fr 4fr 4fr; gap: 4vw; padding: 44px 0; border-bottom: 1px solid var(--rule); align-items: start; }
.row h3 { margin: 10px 0 0; font-weight: 600; font-size: 22px; line-height: 1.25; letter-spacing: -.015em; }
.row p { color: var(--ink2); }
.row .n { font: 500 12px/1 GeistMono, monospace; color: var(--accent-ink); letter-spacing: .08em; }

/* figures */
figure { margin: 0; }
.fig { border-top: 1px solid var(--rule); padding-top: 28px; }
.fig + .fig { margin-top: 64px; }
.cap { margin-top: 18px; display: grid; grid-template-columns: 4fr 8fr; gap: 4vw; font-size: 14.5px; color: var(--ink2); }
.cap b { font: 500 11.5px/1.6 GeistMono, monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }
.legend { display: flex; gap: 22px; flex-wrap: wrap; margin-bottom: 14px; font: 400 12.5px/1 GeistMono, monospace; color: var(--ink2); }
.legend span { display: inline-flex; align-items: center; gap: 8px; }
.legend i { width: 16px; height: 2px; background: var(--c); }
.legend i.d { background: none; height: 0; border-top: 2px dashed var(--c); }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart .grid line { stroke: var(--rule); }
.chart .ax { font: 400 11px GeistMono, monospace; fill: var(--ink3); }
.chart .lbl { font: 500 11.5px GeistMono, monospace; fill: var(--ink); }
.chart .fault { stroke: var(--dead); stroke-dasharray: 3 4; }
.chart .fault-t { font: 500 11px GeistMono, monospace; fill: var(--dead); }
.chart .xh { stroke: var(--ink3); stroke-width: 1; opacity: 0; }
.chart .tip { position: absolute; top: 0; pointer-events: none; opacity: 0; background: var(--card); border: 1px solid var(--rule2); border-radius: 10px; padding: 10px 12px; font: 400 12px/1.6 GeistMono, monospace; color: var(--ink2); min-width: 170px; transform: translateX(12px); }
.chart .tip b { color: var(--ink); font-weight: 500; }
.chart.on .xh, .chart.on .tip { opacity: 1; }
.multi { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 28px; }
.multi .m { border-top: 1px solid var(--rule); padding-top: 14px; }
.multi .m .t { display: flex; justify-content: space-between; font: 400 12px/1 GeistMono, monospace; color: var(--ink2); margin-bottom: 12px; }
.multi .m .t b { color: var(--ink); font-weight: 500; }

/* chain of events */
.chain { border-top: 1px solid var(--rule); }
.chain li { list-style: none; display: grid; grid-template-columns: 80px 1fr; gap: 24px; padding: 22px 0; border-bottom: 1px solid var(--rule); }
.chain { margin: 0; padding: 0; }
.chain .t { font: 500 13px/1.6 GeistMono, monospace; color: var(--ink); display: flex; align-items: baseline; gap: 10px; }
.chain .t i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--ink3)); flex: none; transform: translateY(-1px); }
.chain h4 { margin: 0; font-weight: 600; font-size: 17px; letter-spacing: -.01em; }
.chain p { margin-top: 6px; color: var(--ink2); font-size: 15.5px; }
.num { font: 500 13px/1 GeistMono, monospace; color: var(--ink); font-variant-numeric: tabular-nums; }

/* tables */
.table { width: 100%; border-collapse: collapse; font-size: 15.5px; }
.table th { text-align: left; font: 500 11px/1 GeistMono, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); padding: 0 16px 16px 0; border-bottom: 1px solid var(--rule2); }
.table td { padding: 20px 16px 20px 0; border-bottom: 1px solid var(--rule); vertical-align: top; color: var(--ink2); }
.table td:first-child { color: var(--ink); font-weight: 500; }
.table .st { display: inline-flex; align-items: center; gap: 8px; font: 500 12px/1.4 GeistMono, monospace; white-space: nowrap; color: var(--ink); }
.table .st i { width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.table-wrap { overflow-x: auto; }

/* definitions */
.defs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 4vw; border-top: 1px solid var(--rule); }
.defs div { padding: 28px 0; border-bottom: 1px solid var(--rule); }
.defs h4 { margin: 0; font-weight: 600; font-size: 17px; letter-spacing: -.01em; display: flex; justify-content: space-between; gap: 12px; }
.defs h4 small { font: 500 11px/1.6 GeistMono, monospace; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); font-weight: 500; }
.defs p { margin-top: 8px; color: var(--ink2); font-size: 15.5px; }

/* the node card, flat */
.node { background: var(--card); border: 1px solid var(--rule2); border-left: 3px solid var(--c); border-radius: 12px; padding: 16px 18px; display: grid; gap: 12px; max-width: 300px; }
.node .h { display: flex; justify-content: space-between; align-items: baseline; }
.node .h b { font-weight: 600; font-size: 15px; }
.node .h span { font: 500 11.5px/1 GeistMono, monospace; color: var(--c); }
.node dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; padding: 12px 0; border-block: 1px solid var(--rule); font-size: 13.5px; color: var(--ink2); }
.node dd { margin: 0; font: 500 12.5px/1.5 GeistMono, monospace; color: var(--ink); text-align: right; }
.node p { font-size: 13.5px; color: var(--ink2); line-height: 1.5; }

/* questions */
.faq { border-top: 1px solid var(--rule); }
.faq details { border-bottom: 1px solid var(--rule); }
.faq summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; gap: 24px; padding: 26px 0; font-weight: 500; font-size: 19px; letter-spacing: -.01em; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; font: 400 22px/1 GeistMono, monospace; color: var(--ink3); }
.faq details[open] summary::after { content: "–"; }
.faq details p { padding: 0 0 28px; max-width: 44em; color: var(--ink2); }

/* closing + footer */
.close { padding-top: 160px; padding-bottom: 160px; border-bottom: 1px solid var(--rule); }
.close h2 { margin: 0; font-weight: 600; font-size: clamp(32px, 3.6vw, 52px); line-height: 1.08; letter-spacing: -.03em; max-width: 16em; text-wrap: balance; }
.close .lead { margin-top: 22px; }
.close .btns { margin-top: 40px; }
.foot { padding-top: 72px; padding-bottom: 56px; }
.foot .cols { display: grid; grid-template-columns: 4fr repeat(3, 2fr); gap: 4vw; }
.foot h5 { margin: 0 0 16px; font: 500 11px/1 GeistMono, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); }
.foot ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 15px; color: var(--ink2); }
.foot .small { margin-top: 72px; padding-top: 24px; border-top: 1px solid var(--rule); display: flex; justify-content: space-between; font-size: 13.5px; color: var(--ink3); }

@media (max-width: 980px) {
  .nav { display: none; } .bar .wrap { grid-template-columns: 1fr auto; }
  .open .wrap, .sec-head, .sec-body.split, .row, .cap, .foot .cols { grid-template-columns: 1fr; }
  .sec-head .side { padding-top: 0; } .multi { grid-template-columns: repeat(2, minmax(0, 1fr)); } .defs { grid-template-columns: 1fr; }
  .sec { padding-top: 96px; padding-bottom: 96px; }
}
`;

// ---- page pieces ----
export const bar = (site, links) => `<header class="bar"><div class="wrap">
  <a class="mark" href="/"><i></i>InfraForge <span>/ ${site}</span></a>
  <nav class="nav" aria-label="Sections">${links.map(([href, t]) => `<a href="#${href}">${t}</a>`).join("")}</nav>
  <div class="right"><button class="mode" type="button" aria-label="Switch light or dark mode"><i></i><span>Mode</span></button><a href="/signin">Sign in</a></div></div></header>`;
export const bench = (name, cls = "") => `<div class="figure-bench ${cls}"><div class="iso bench-iso" data-theme="light">${still(name)}</div></div>`;
export const secHead = (id, n, title, lead, more = "") => `<div class="sec-head"><div><div class="mono">${n}</div><h2 id="${id}">${title}</h2></div><div class="side"><p class="lead">${lead}</p>${more}</div></div>`;
export const caption = (label, text) => `<figcaption class="cap"><b>${label}</b><span>${text}</span></figcaption>`;
export const faq = (items) => `<div class="faq">${items.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>`;
export const footer = (site) => `<footer class="foot wrap"><div class="cols">
  <div><a class="mark" href="/"><i></i>InfraForge</a><p style="margin-top:16px;color:var(--ink2);font-size:15px;max-width:22em">Design infrastructure, run it under recorded load, and see exactly why it breaks.</p></div>
  <div><h5>Product</h5><ul><li><a href="/engineering">Engineering</a></li><li><a href="/learning">Learning</a></li><li><a href="/design">Canvas</a></li><li><a href="/runs">Recorded runs</a></li></ul></div>
  <div><h5>Learn</h5><ul><li><a href="/challenges">Challenges</a></li><li><a href="/learning#concepts">Concepts</a></li><li>Docs</li></ul></div>
  <div><h5>Company</h5><ul><li>About</li><li>Contact</li><li>Privacy</li></ul></div></div>
  <div class="small"><span>© 2026 InfraForge</span><span>${site} · every number on this page is from a recorded run</span></div></footer>`;

// ---- charts (one axis, thin marks, direct labels, legend, hover) ----
// series: [{ id, label, values, color, dash }]
export function lineChart({ id, series: S2, yMax = 100, yUnit = "%", height = 300, fault = RUN.fault.at, ticks = [0, 25, 50, 75, 100] }) {
  const W = 1080, H = height, L = 40, R = 86, T = 16, B = 30, n = S2[0].values.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - v / yMax) * (H - T - B);
  const path = (v) => v.map((p, i) => (p === null ? "" : `${i && v[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`)).join(" ");
  const ends = S2.filter((s) => s.values[n - 1] !== null).map((s) => ({ s, yy: y(s.values[n - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  const fx = x(fault - 1);
  return `<div class="legend">${S2.map((s) => `<span><i class="${s.dash ? "d" : ""}" style="--c:${s.color}"></i>${s.label}</span>`).join("")}</div>
<div class="chart" id="${id}" data-n="${n}" data-l="${L}" data-r="${R}" data-w="${W}" data-series='${JSON.stringify(S2.map((s) => ({ label: s.label, values: s.values })))}' data-unit="${yUnit}">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(S2.map((s) => s.label).join(", "))} over ${n} recorded seconds">
  <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>
  ${ticks.map((t) => `<text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
  ${[0, 15, 30, 45, 60, 75, 90].map((t) => `<text class="ax" x="${x(Math.min(n - 1, Math.max(0, t - 1)))}" y="${H - 8}" text-anchor="middle">${t}s</text>`).join("")}
  <line class="fault" x1="${fx}" x2="${fx}" y1="${T}" y2="${H - B}"/><text class="fault-t" x="${fx - 8}" y="${y(yMax * 0.2) + 4}" text-anchor="end">app-2 crashes · ${fault}s</text>
  ${S2.map((s) => `<path d="${path(s.values)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>`).join("")}
  ${ends.map(({ s, yy }) => `<text class="lbl" x="${W - R + 10}" y="${yy + 4}">${s.label}</text>`).join("")}
  <line class="xh" x1="0" x2="0" y1="${T}" y2="${H - B}"/>
</svg><div class="tip"></div></div>`;
}
export function spark({ values, color, yMax, height = 90, fault = RUN.fault.at }) {
  const W = 260, H = height, n = values.length, x = (i) => (i / (n - 1)) * W, y = (v) => 6 + (1 - v / yMax) * (H - 12);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--rule)"/><line class="fault" x1="${x(fault - 1)}" x2="${x(fault - 1)}" y1="0" y2="${H}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg></div>`;
}

// ---- behaviour: mode switch (remembered) and chart hover ----
export const script = `<script>
(() => {
  const root = document.documentElement;
  const set = (m) => { root.dataset.mode = m; for (const el of document.querySelectorAll(".bench-iso")) el.dataset.theme = m; };
  let saved = null; try { saved = localStorage.getItem("if-mode"); } catch {}
  set(new URLSearchParams(location.search).get("mode") || saved || "light");
  document.querySelector(".mode")?.addEventListener("click", () => { const m = root.dataset.mode === "dark" ? "light" : "dark"; set(m); try { localStorage.setItem("if-mode", m); } catch {} });
  for (const c of document.querySelectorAll(".chart[data-series]")) {
    const svg = c.querySelector("svg"), xh = c.querySelector(".xh"), tip = c.querySelector(".tip");
    const n = +c.dataset.n, L = +c.dataset.l, R = +c.dataset.r, W = +c.dataset.w, S = JSON.parse(c.dataset.series), unit = c.dataset.unit;
    svg.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((vx - L) / (W - L - R)) * (n - 1)))), px = L + (i / (n - 1)) * (W - L - R);
      xh.setAttribute("x1", px); xh.setAttribute("x2", px);
      tip.innerHTML = "second <b>" + (i + 1) + "</b><br>" + S.map((s) => s.label + " <b>" + (s.values[i] === null ? "–" : Math.round(s.values[i] * 10) / 10 + unit) + "</b>").join("<br>");
      const left = (px / W) * r.width; tip.style.left = (left > r.width - 200 ? left - 200 : left) + "px"; c.classList.add("on");
    });
    svg.addEventListener("pointerleave", () => c.classList.remove("on"));
  }
})();
</script>`;

export const page = ({ title, description, accent, body }) => `<!doctype html><html lang="en" data-mode="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${esc(description)}"><style>${css(accent)}</style></head><body>${body}${script}</body></html>`;
