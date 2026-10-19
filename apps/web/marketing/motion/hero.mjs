// The InfraForge hero: the assembly film running live, full window. On load the
// parts fly in through the dark, the cables join, the surge turns the world to
// light; then scrolling plays the recorded run in place (the page never moves:
// one pinned window, like Orra or Hubtown). Writes hero.html (self-contained).
//
// usage: node motion/hero.mjs [--artifact]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fontUrl } from "../assets.mjs";
import * as k from "../kit/iso-kit.mjs";
import { turnScript } from "../scripts/inline-kit.mjs";
import { scene, PAGE_HELPERS } from "../object/scene.mjs";
import { FILM } from "../object/film.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("Usage: node motion/hero.mjs <output-directory>");
mkdirSync(OUTPUT, { recursive: true });
const S = scene({ W: 540, H: 960, radius: FILM.radius * 1.05, pad: 0 });
const source = (file) => readFileSync(file, "utf8").replace(/^export /gm, "");
const film = source(join(HERE, "..", "object", "film.mjs"));
const timeline = source(join(HERE, "timeline.mjs"));
const look = readFileSync(join(HERE, "look.css"), "utf8");
const sound = readFileSync(join(HERE, "sound.js"), "utf8");

const stage = `<div class="iso-stage iso-turn">${k.figureSvg({ width: 960, height: 540, label: FILM.label, body: "" })}<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer under" viewBox="0 0 960 540" aria-hidden="true"></svg>${S.out.layerSvg("live", { width: 960, height: 540 })}<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer fx" viewBox="0 0 960 540" aria-hidden="true"></svg></div>`;

const css = `
@font-face { font-family: InterTight; src: url(${fontUrl("inter-tight-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: GeistMono; src: url(${fontUrl("geist-mono-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }
${look}
/* full window: the film owns the whole viewport; the page height only feeds the scroll */
html, body { margin: 0; background: #080808; }
body { min-height: 100%; }
.track { height: 620vh; }
.mo { position: fixed; inset: 0; width: 100vw; height: 100vh; height: 100dvh; --mo-w: 100vw; --mo-h: 100vh; }
.mo .iso-stage, .mo .iso-svg { width: 100%; height: 100%; }
.mo .mo-bg { inset: -6%; }
/* overlay: one quiet layer of type over the world, in the theme of the moment */
.ui { position: fixed; inset: 0; pointer-events: none; z-index: 5; color: var(--ink); font: 400 16px/1.5 InterTight, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  --ink: #f2eee8; --ink2: rgba(242,238,232,.64); --rule: rgba(242,238,232,.16); --pill: rgba(255,255,255,.06); transition: color .8s; }
.ui[data-theme="light"] { --ink: #1c1915; --ink2: rgba(28,25,21,.62); --rule: rgba(28,25,21,.14); --pill: rgba(255,255,255,.55); }
.ui a, .ui button { pointer-events: auto; color: inherit; text-decoration: none; }
.bar { position: absolute; top: 0; left: 0; right: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
  padding: calc(22px + env(safe-area-inset-top, 0px)) max(28px, env(safe-area-inset-right, 0px)) 0 max(28px, env(safe-area-inset-left, 0px)); }
.mark { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 17px; letter-spacing: -.01em; }
.mark i { width: 18px; height: 18px; border: 1.5px solid currentColor; border-radius: 5px; position: relative; }
.mark i::after { content: ""; position: absolute; left: 3px; top: 3px; width: 6px; height: 6px; border-radius: 50%; background: #ee8a3c; }
.nav { display: flex; gap: 4px; padding: 5px; border: 1px solid var(--rule); border-radius: 999px; background: var(--pill); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.nav a { font-size: 13.5px; padding: 7px 14px; border-radius: 999px; color: var(--ink2); transition: color .2s, background .2s; }
.nav a:hover { color: var(--ink); background: var(--pill); }
.signin { justify-self: end; font-size: 13.5px; padding: 9px 16px; border: 1px solid var(--rule); border-radius: 999px; background: var(--pill); backdrop-filter: blur(12px); }
.copy { position: absolute; left: max(40px, 4vw); bottom: max(44px, 7vh); max-width: min(620px, 86vw); }
.kicker { font: 500 11.5px/1 GeistMono, ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--ink2); }
.copy h1 { margin: 16px 0 0; font-weight: 600; font-size: clamp(38px, 5.2vw, 76px); line-height: 1; letter-spacing: -.035em; text-wrap: balance; }
.copy p { margin: 16px 0 0; max-width: 44ch; font-size: 17px; color: var(--ink2); text-wrap: pretty; }
.choose { display: flex; gap: 10px; margin-top: 26px; flex-wrap: wrap; }
.choose a { display: inline-flex; align-items: center; gap: 10px; padding: 13px 20px; border-radius: 999px; font-weight: 500; font-size: 15px; border: 1px solid var(--rule); background: var(--pill); backdrop-filter: blur(12px); transition: transform .25s; }
.choose a:hover { transform: translateY(-1px); }
.choose a.primary { background: var(--ink); color: #fbf7f0; border-color: transparent; }
.ui[data-theme="light"] .choose a.primary { color: #fbf7f0; }
.ui:not([data-theme="light"]) .choose a.primary { color: #1c1915; }
.choose span { font: 400 11.5px/1 GeistMono, monospace; opacity: .62; }
/* each chapter's words appear in place; nothing scrolls */
.beat { opacity: 0; transform: translateY(10px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
.beat.on { opacity: 1; transform: none; }
.chapter { position: absolute; left: max(40px, 4vw); bottom: max(44px, 7vh); max-width: min(560px, 86vw); }
.chapter h2 { margin: 14px 0 0; font-weight: 600; font-size: clamp(30px, 3.6vw, 52px); line-height: 1.04; letter-spacing: -.03em; text-wrap: balance; }
.chapter h2 em { font-style: normal; color: #d4524f; }
.rail { position: absolute; left: max(40px, 4vw); top: calc(96px + env(safe-area-inset-top, 0px)); display: grid; gap: 10px; justify-items: start; }
.rail div { flex-direction: row-reverse; }
.rail div { display: flex; align-items: center; gap: 12px; font: 500 11px/1 GeistMono, monospace; letter-spacing: .12em; text-transform: uppercase; color: var(--ink2); opacity: .55; transition: opacity .4s; }
.rail div i { width: 18px; height: 1.5px; background: currentColor; transition: width .4s; }
.rail div.on { opacity: 1; color: var(--ink); }
.rail div.on i { width: 36px; }
.readout { position: absolute; right: max(32px, 3vw); bottom: max(44px, 7vh); font: 500 12px/1.5 GeistMono, monospace; color: var(--ink2); text-align: right; font-variant-numeric: tabular-nums; }
.readout b { color: var(--ink); font-weight: 500; }
.cue { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); font: 500 11px/1 GeistMono, monospace; letter-spacing: .14em; text-transform: uppercase; color: var(--ink2); }
.right { justify-self: end; display: flex; align-items: center; gap: 10px; }
.sound { display: flex; align-items: center; gap: 9px; font: 500 12px/1 GeistMono, monospace; letter-spacing: .1em; text-transform: uppercase; padding: 10px 14px; border: 1px solid var(--rule); border-radius: 999px; background: var(--pill); backdrop-filter: blur(12px); color: var(--ink2); cursor: pointer; }
.sound i { display: flex; align-items: flex-end; gap: 2px; height: 10px; }
.sound i b { width: 2px; background: currentColor; height: 40%; border-radius: 1px; }
.sound i b:nth-child(2) { height: 75%; } .sound i b:nth-child(3) { height: 55%; } .sound i b:nth-child(4) { height: 30%; }
.sound[aria-pressed="true"] { color: var(--ink); }
.sound.waiting { color: var(--ink); border-color: #e8b96588; animation: ask 2.4s ease-in-out infinite; }
.sound.waiting i b { background: #e8b965; }
@keyframes ask { 50% { box-shadow: 0 0 0 6px #e8b96512, 0 0 18px #e8b96530; } }
.sound[aria-pressed="true"] i b { background: #e8b965; animation: eq .9s ease-in-out infinite alternate; }
.sound[aria-pressed="true"] i b:nth-child(2) { animation-delay: -.3s; } .sound[aria-pressed="true"] i b:nth-child(3) { animation-delay: -.6s; } .sound[aria-pressed="true"] i b:nth-child(4) { animation-delay: -.15s; }
@keyframes eq { from { height: 25%; } to { height: 100%; } }
/* the node card: the canvas's own node, attached to the module under the pointer */
.card { position: absolute; z-index: 6; top: calc(84px + env(safe-area-inset-top, 0px)); right: max(28px, 3vw); width: 248px; padding: 14px 16px 12px; border-radius: 14px; pointer-events: none; color: #f3ece2;
  background: linear-gradient(180deg, rgba(24,24,24,.95), rgba(12,12,12,.95)); border: 1px solid rgba(242,238,232,.12);
  box-shadow: 0 18px 50px -18px rgba(0,0,0,.6), -3px 0 0 0 var(--st, #3fb98f) inset, -10px 0 28px -14px var(--st, #3fb98f);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); opacity: 0; transform: translateY(6px) scale(.98); transition: opacity .25s, transform .3s cubic-bezier(.2,.7,.2,1); }
.card.on { opacity: 1; transform: none; }
.card .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.card .name { font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
.card .type { font: 500 10.5px/1 GeistMono, monospace; letter-spacing: .1em; text-transform: uppercase; color: rgba(243,236,226,.55); margin-top: 4px; }
.card .rows { display: grid; gap: 6px; margin: 12px 0 10px; padding: 10px 0; border-block: 1px solid rgba(243,226,200,.1); }
.card .row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: rgba(243,236,226,.72); }
.card .row b { font: 500 12.5px/1 GeistMono, monospace; color: #f7f1e8; font-variant-numeric: tabular-nums; }
.card .port { display: inline-flex; align-items: center; gap: 7px; }
.card .port i { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 3px rgba(0,0,0,.25), 0 0 10px var(--c); }
.card .status { display: flex; align-items: center; gap: 8px; font: 500 11.5px/1 GeistMono, monospace; color: var(--st, #3fb98f); }
.card .status i { width: 7px; height: 7px; border-radius: 50%; background: var(--st, #3fb98f); box-shadow: 0 0 10px var(--st, #3fb98f); }
.chapter ol { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 7px; }
.chapter li { display: flex; gap: 12px; font-size: 15px; color: var(--ink2); }
.chapter li b { font: 500 12px/1.6 GeistMono, monospace; color: var(--ink); min-width: 34px; }
.chapter p { margin: 14px 0 0; font-size: 16px; color: var(--ink2); max-width: 46ch; }
.chapter p strong { color: var(--ink); font-weight: 600; }
/* the title moment: the first heavy frames happen behind the wordmark */
.title { position: fixed; inset: 0; z-index: 7; display: grid; place-items: center; pointer-events: none; color: #f5efe6; transition: opacity .9s ease; }
.title.gone { opacity: 0; }
.title div { display: grid; justify-items: center; gap: 14px; }
.title .wm { display: flex; align-items: center; gap: 14px; font: 600 28px/1 InterTight, system-ui, sans-serif; letter-spacing: -.02em; }
.title .wm i { width: 26px; height: 26px; border: 2px solid currentColor; border-radius: 7px; position: relative; }
.title .wm i::after { content: ""; position: absolute; left: 5px; top: 5px; width: 8px; height: 8px; border-radius: 50%; background: #ee8a3c; box-shadow: 0 0 12px #ee8a3c; }
.title small { font: 500 11px/1 GeistMono, monospace; letter-spacing: .18em; text-transform: uppercase; color: rgba(245,239,230,.55); }
.title span { width: 160px; height: 1px; background: rgba(245,239,230,.14); position: relative; overflow: hidden; }
.title span::after { content: ""; position: absolute; inset: 0; background: #e8b965; transform-origin: left; transform: scaleX(var(--p, 0)); }
@media (orientation: portrait) {
  .card { top: auto; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); width: auto; }
  .card .rows { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 14px; }
  .card .row { flex-direction: column; align-items: flex-start; gap: 4px; }
}
@media (max-width: 1100px) { .readout { display: none; } }
@media (max-width: 760px) { .cue { display: none; } }
@media (max-width: 760px) { .nav, .rail { display: none; } .bar { grid-template-columns: 1fr auto; } .readout { display: none; } .copy, .chapter { left: 22px; right: 22px; bottom: 36px; } .sound:not(.waiting) span { display: none; } .signin { display: none; } }
@media (prefers-reduced-motion: reduce) { .beat { transition: none; } }
`;

const ui = `
<div class="title"><div><div class="wm"><i></i>InfraForge</div><small>Assembling a production system</small><span></span></div></div>
<div class="ui" data-theme="dark">
  <header class="bar"><a class="mark" href="#"><i></i>InfraForge</a>
    <nav class="nav"><a href="/learning">Challenges</a><a href="/engineering">Canvas</a><a href="#">Docs</a></nav>
    <div class="right"><button class="sound" type="button" aria-pressed="false"><i><b></b><b></b><b></b><b></b></i><span>Sound</span></button><a class="signin" href="/signin">Sign in</a></div></header>
  <div class="card" role="status" aria-live="polite"></div>
  <section class="copy beat" data-show="hero">
    <div class="kicker">Recorded load · real failures</div>
    <h1>See exactly why your system breaks.</h1>
    <p>Design infrastructure, run it under recorded load, and watch every part respond, second by second.</p>
    <div class="choose"><a class="primary" href="/learning">I'm learning <span>guided</span></a><a href="/engineering">I'm engineering <span>free canvas</span></a></div>
  </section>
  <section class="chapter beat" data-show="split"><div class="kicker">02 · Live traffic</div><h2>The balancer splits every request between two servers.</h2><ol><li><b>59s</b>130 requests a second, 65 to each server</li><li><b>59s</b>both servers near 43% CPU, the database at 62%</li></ol></section>
  <section class="chapter beat" data-show="fail"><div class="kicker">03 · The failure</div><h2><em>app-2 crashes.</em> Like a host dying mid-shift.</h2><ol><li><b>60s</b>a crash is injected into app-2: its process stops</li><li><b>61s</b>app-2 answers nothing; its cables drain</li><li><b>61s</b>the balancer is left with one server</li></ol></section>
  <section class="chapter beat" data-show="reroute"><div class="kicker">04 · The re-route</div><h2>Everything shifts to app-1.</h2><ol><li><b>61s</b>app-1 takes all 130 requests a second</li><li><b>61s</b>its CPU jumps from 43% to 86%</li></ol></section>
  <section class="chapter beat" data-show="pinned"><div class="kicker">05 · Saturation</div><h2>app-1 pins at 100% CPU. The database saturates.</h2><ol><li><b>62s</b>the database reaches 95% CPU</li><li><b>63s</b>app-1 reaches 100% CPU: no headroom left</li></ol></section>
  <section class="chapter beat" data-show="why"><div class="kicker">06 · Why it broke</div><h2>Each server was sized for half the load. Losing one left no room for the other half.</h2><p><strong>A fix to try:</strong> a third server or autoscaling with headroom, then replay this exact recording to compare.</p></section>
  <section class="copy beat" data-show="end">
    <div class="kicker">Evaluated at second 90</div>
    <h1>Now break your own.</h1>
    <div class="choose"><a class="primary" href="/learning">I'm learning <span>guided</span></a><a href="/engineering">I'm engineering <span>free canvas</span></a></div>
  </section>
  <nav class="rail" aria-label="Chapters"><div data-ch="hero"><span>Assemble</span><i></i></div><div data-ch="split"><span>Traffic</span><i></i></div><div data-ch="fail"><span>Failure</span><i></i></div><div data-ch="reroute"><span>Re-route</span><i></i></div><div data-ch="pinned"><span>Saturation</span><i></i></div><div data-ch="why"><span>Why</span><i></i></div><div data-ch="end"><span>Your turn</span><i></i></div></nav>
  <div class="readout beat" data-show="live"></div>
  <div class="cue beat" data-show="cue">Scroll to run the recording</div>
</div>`;

const body = `<style>${S.out.css}\n${css}</style><div class="iso mo" data-theme="dark" data-plate="off"><div class="mo-bg"></div><canvas class="dust" data-layer="back"></canvas>${stage}<canvas class="dust" data-layer="front"></canvas><div class="mo-vignette"></div><div class="mo-flash"></div></div>${ui}<div class="track"></div>`;

const DATA = { origin: S.obj.root.origin, turn: S.out.data, explode: S.obj.explode, basis: S.basis, anchors: S.obj.anchors, W: 960, H: 540, ratio: "live", counts: { parts: S.out.report.parts } };

const LIVE = `const DATA = ${JSON.stringify(DATA)};
// the frame matches the window's own shape, and follows it on every resize
let PORTRAIT = false;
function sizeFrame() { const a = innerWidth / innerHeight; if (a >= 1) { DATA.W = 960; DATA.H = Math.round(960 / a); } else { DATA.W = 540; DATA.H = Math.round(540 / a); } PORTRAIT = DATA.H > DATA.W; }
sizeFrame();
${PAGE_HELPERS}
${film}
${timeline}
${sound}
const root = document.querySelector(".mo");
const stage = root.querySelector(".iso-stage");
const svgs = [...stage.querySelectorAll("svg")];
const bg = root.querySelector(".mo-bg");
const ui = document.querySelector(".ui");
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
let lastView = null;
let setMs = 8, frameNo = 0, lastVB = "";
function applyState(s, redraw = true) {
  const view = (lastView = s.view || viewOf(s));
  if (redraw) {
    const t0 = performance.now();
    ctl.set({ root: { R: view.M }, ...featureValues(s, explodeValues(s.apart)) }, { detail: s.detail ?? 1 });
    setMs = setMs * 0.9 + (performance.now() - t0) * 0.1; window.__setMs = setMs;
  }
  const vb = view.x.toFixed(3) + " " + view.y.toFixed(3) + " " + view.w.toFixed(3) + " " + view.h.toFixed(3);
  if (redraw && vb !== lastVB) { for (const svg of svgs) svg.setAttribute("viewBox", vb); lastVB = vb; }
  const [gx, gy, gr] = s.glow;
  bg.style.setProperty("--gx", (gx * 100).toFixed(2) + "%");
  bg.style.setProperty("--gy", (gy * 100).toFixed(2) + "%");
  bg.style.setProperty("--gr", (gr * 100).toFixed(2) + "%");
  paint(s, stage, null);
}

// ---- the driver: the assembly plays by itself, then scroll owns the recorded run ----
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTrack = document.querySelector(".track");
const beats = [...ui.querySelectorAll(".beat")], rail = [...ui.querySelectorAll(".rail div")];
const readout = ui.querySelector(".readout"), card = ui.querySelector(".card"), title = document.querySelector(".title");
let intro = reduce ? ASSEMBLY_END : 0, last = 0, clock = 0, tShown = 0, tPrev = 0, orbit = 0, orbitW = 0;
let mx = 0, my = 0, ex = 0, ey = 0, px = -1, py = -1, touched = false;
addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; if (e.pointerType === "mouse") { px = e.clientX; py = e.clientY; } }, { passive: true });
addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") { px = e.clientX; py = e.clientY; touched = true; } }, { passive: true });
addEventListener("pointerleave", () => { px = py = -1; });
const scrollP = () => Math.min(Math.max(scrollY / Math.max(scrollTrack.offsetHeight - innerHeight, 1), 0), 1);
function chapterAt(t, sec) {
  if (t < ASSEMBLY_END - 0.05) return intro < ASSEMBLY_END ? "assembling" : "hero";
  if (t < ASSEMBLY_END + 0.4) return "hero";
  if (sec < 60.9) return "split";
  if (sec < 63.2) return "fail";
  if (sec < 68) return "reroute";
  if (sec < 80) return "pinned";
  if (sec < 89.5) return "why";
  return "end";
}
// on a phone the system runs down the screen, above the words
function atFramed(t) {
  const s = at(t);
  if (t < ASSEMBLY_END - 1.2) { s.yaw = -40; s.pitch = 29; s.roll = 0; }
  else if (t < ASSEMBLY_END) { const e = (t - (ASSEMBLY_END - 1.2)) / 1.2, k = e * e * (3 - 2 * e); s.yaw = -40 + (s.yaw + 40) * k; s.pitch = 29 + (s.pitch - 29) * k; s.roll *= k; }
  if (PORTRAIT) { const intro = t < ASSEMBLY_END - 0.6; s.yaw -= 62; s.pitch += 6; s.panX = 0; s.panY = intro ? 40 : 270; s.zoom *= intro ? 0.8 : t > ASSEMBLY_END + 0.5 ? 0.74 : 0.84; }
  return s;
}
// the film's moments, for sound: landings, joins, the surge, the failure
const EVENTS = [];
(() => {
  const fly = SCHEDULE.fly, landed = {};
  for (let t = 0; t <= ASSEMBLY_END; t += 1 / 120) { const b = at(t).build; for (const id in fly) if (!landed[id] && b >= fly[id][1]) { landed[id] = 1; EVENTS.push([t, "whoosh"]); } }
})();
let eventsReady = false;
function fireEvents(a, b) {
  if (!eventsReady && typeof PAINT !== "undefined" && PAINT) { for (const j of PAINT.joins) if (isFinite(j)) EVENTS.push([j, "crackle"]); if (isFinite(PAINT.tLight)) EVENTS.push([PAINT.tLight, "surge"]); if (isFinite(PAINT.tFail)) EVENTS.push([PAINT.tFail, "alarm"]); eventsReady = true; }
  if (b <= a) return;
  for (const [t, kind] of EVENTS) if (t > a && t <= b) Sound[kind]();
}
// sound is on by default; browsers only allow audio after the visitor's first click, tap or key,
// so the engine starts then (a click on the button itself turns it off instead)
const soundBtn = ui.querySelector(".sound"), soundLabel = soundBtn.querySelector("span");
// wanted: the visitor has not turned it off. The button only shows "on" once audio is really playing;
// until the first click, tap or key it shows "tap for sound" (scrolling does not count as permission).
let soundWanted = true;
const showSound = () => { const live = Sound.on; soundBtn.setAttribute("aria-pressed", String(live)); soundBtn.classList.toggle("waiting", soundWanted && !live); soundLabel.textContent = soundWanted && !live ? "Tap for sound" : "Sound"; };
const startSound = async () => { if (soundWanted && !Sound.on) await Sound.enable(); showSound(); };
for (const ev of ["pointerdown", "keydown", "touchend"]) addEventListener(ev, (e) => { if (!soundBtn.contains(e.target)) startSound(); }, { passive: true });
soundBtn.addEventListener("click", async () => {
  if (Sound.on) { soundWanted = false; await Sound.disable(); } else { soundWanted = true; await Sound.enable(); }
  showSound();
});
showSound();
// some browsers already allow sound on a site the visitor has engaged with before: try at once
Sound.enable().then(showSound);

// the node card: what the module under the pointer is doing right now
const INFO = {
  dns: { name: "DNS", type: "Resolver", ins: [], outs: [["lb", "#d6b27a"]] },
  lb: { name: "Load balancer", type: "Layer 7", ins: [["dns", "#d6b27a"]], outs: [["app-1", "#d9773b"], ["app-2", "#d9773b"]] },
  "app-1": { name: "app-1", type: "Virtual machine", ins: [["lb", "#d9773b"]], outs: [["db", "#b5626a"]] },
  "app-2": { name: "app-2", type: "Virtual machine", ins: [["lb", "#d9773b"]], outs: [["db", "#b5626a"]] },
  db: { name: "Database", type: "Primary", ins: [["app-1", "#b5626a"], ["app-2", "#b5626a"]], outs: [] },
};
const STATUS = [["Serving", "#46c79b"], ["Warm", "#e2a43a"], ["Saturated", "#ef7a3c"], ["Failed", "#e2574c"]];
let cardId = null;
var HOVER = null;
function updateCard(sec, live) {
  let hit = null;
  if (live && px >= 0 && lastView) {
    let best = Infinity;
    for (const id in INFO) {
      const q = screenOf(about(lastView.M, DATA.anchors[id])), [hw, hd] = DATA.anchors["fp." + id];
      const x = ((q[0] - lastView.x) / lastView.w) * innerWidth, y = ((q[1] - lastView.y) / lastView.h) * innerHeight;
      // the open card holds until the pointer is clearly away, so the breathing camera cannot flicker it
      const r = (Math.max(hw, hd) * BK / lastView.w) * innerWidth * (id === cardId ? 1.8 : 1.25), d = Math.hypot(px - x, py - y);
      if (d < r && d < best) { best = d; hit = { id, x, y }; }
    }
  }
  if (!hit) { if (cardId) { card.classList.remove("on"); cardId = null; HOVER = null; } return; }
  const st = stationsAt(sec)[hit.id], info = INFO[hit.id], [label, colour] = STATUS[st.h];
  const port = ([to, c]) => '<span class="port" style="--c:' + c + '"><i></i>' + to + "</span>";
  const html = '<div class="head"><div><div class="name">' + info.name + '</div><div class="type">' + info.type + '</div></div><div class="status"><i></i>' + label + "</div></div>" +
    '<div class="rows"><div class="row">Requests<b>' + (st.dead ? "0" : st.rps) + ' rps</b></div><div class="row">CPU<b>' + (st.dead ? "—" : Math.round(st.cpu) + "%") + '</b></div><div class="row">Recorded second<b>' + Math.floor(sec) + "</b></div></div>" +
    '<div class="row">' + (info.ins.length ? info.ins.map(port).join(" ") : "<span></span>") + '<span style="opacity:.5">→</span>' + (info.outs.length ? info.outs.map(port).join(" ") : "<span>store</span>") + "</div>";
  if (card.innerHTML !== html) card.innerHTML = html;
  card.style.setProperty("--st", colour);
  card.classList.add("on"); cardId = hit.id; HOVER = hit.id;
}

// ---- gold dust on two canvases (behind and in front of the parts) ----
const dustBack = root.querySelector('.dust[data-layer="back"]'), dustFront = root.querySelector('.dust[data-layer="front"]');
const dpr = Math.min(devicePixelRatio || 1, 1.5);
function sizeDust() { for (const c of [dustBack, dustFront]) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); } }
sizeDust();
// on resize: re-measure the frame, then re-fit and redraw at once (no easing from the old shape)
// keep the visitor in the same moment of the story: the track is measured in window heights, so restore its progress
let lastP = 0;
addEventListener("resize", () => { sizeFrame(); sizeDust(); cur = null; lastYaw = null; lastVB = ""; owed = true; scrollTo(0, lastP * Math.max(scrollTrack.offsetHeight - innerHeight, 0)); });
const MOTES = Array.from({ length: 64 }, (_, i) => { const r = mulberry(1000 + i); return [r(), r(), r(), r()]; });
function drawDust(clock, light) {
  for (const [c, front] of [[dustBack, false], [dustFront, true]]) {
    const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < MOTES.length; i++) {
      const big = i < 6; if (big !== front) continue;
      const [a, y0, sp, tw] = MOTES[i];
      const fy = (((y0 - clock * (0.006 + sp * 0.012)) % 1) + 1) % 1, fx = a + Math.sin(clock * (0.2 + sp * 0.3) + i) * 0.012;
      const x = fx * c.width, y = fy * c.height, o = (light ? 0.22 : 0.6) * (0.45 + 0.55 * Math.abs(Math.sin(clock * (0.6 + tw) + i)));
      const r = (big ? 9 : 1 + sp * 1.6) * dpr;
      const grad = g.createRadialGradient(x, y, 0, x, y, r * (big ? 1 : 2.4));
      const col = light ? "201,168,106" : "240,211,152";
      grad.addColorStop(0, "rgba(" + col + "," + (big ? o * 0.45 : o) + ")"); grad.addColorStop(1, "rgba(" + col + ",0)");
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r * (big ? 1 : 2.4), 0, Math.PI * 2); g.fill();
    }
  }
}

// ---- once assembled, the whole system fits the free space beside the words ----
const HEIGHT = { dns: 180, lb: 52, "app-1": 64, "app-2": 64, db: 80 };
const PTS = [];
for (const id of Object.keys(HEIGHT)) {
  const g = DATA.anchors["gnd." + id], [hw, hd] = DATA.anchors["fp." + id];
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const z of [0, HEIGHT[id]]) PTS.push([g[0] + dx * hw, g[1] + dy * hd, z]);
}
// The free space is the window minus the words: below the words' top edge the scene must stay
// right of them; above it, it may use the whole width (clear of the chapter list).
function freeSpace() {
  const W = innerWidth, H = innerHeight;
  if (PORTRAIT) {
    const words = ui.querySelector(".copy.on, .chapter.on") || ui.querySelector(".copy");
    const top = Math.min(words.getBoundingClientRect().top, H * 0.62) - 28;
    return { left: () => 20, right: () => W - 20, x1: W - 20, y0: 76, y1: Math.max(H * 0.36, top) };
  }
  const words = ui.querySelector(".copy.on, .chapter.on") || ui.querySelector(".copy");
  const wr = words.getBoundingClientRect(), rr = ui.querySelector(".rail").getBoundingClientRect();
  const textTop = wr.top - 28, textRight = wr.left + Math.min(wr.width, 640) + 44, railBottom = rr.bottom + 24, railRight = rr.right + 48;
  const cardBottom = 84 + 250;
  return { left: (y) => (y > textTop ? textRight : y < railBottom ? railRight : 48), right: (y) => (y < cardBottom ? W - 48 - 248 - 32 : W - 48), x1: W - 48, y0: 92, y1: H - 92 };
}
function fitView(s) {
  const M = orient(s.yaw, s.pitch, s.roll), q = PTS.map((p) => screenOf(about(M, p)));
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [x, y] of q) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const F = freeSpace();
  // place at scale k with the top at screen y = ty: the leftmost legal x shift, if any
  const place = (k, ty) => {
    let tx = -Infinity, txMax = Infinity;
    for (const [x, y] of q) { const sy = ty + (y - by0) * k; tx = Math.max(tx, F.left(sy) - (x - bx0) * k); txMax = Math.min(txMax, F.right(sy) - (x - bx0) * k); }
    return tx <= txMax ? tx : null;
  };
  let lo = 0, hi = Math.min((F.x1 - 48) / (bx1 - bx0), (F.y1 - F.y0) / (by1 - by0)), best = null;
  for (let it = 0; it < 18; it++) {
    const k = (lo + hi) / 2; let ok = null;
    const room = F.y1 - F.y0 - (by1 - by0) * k;
    for (let j = 0; j <= 8 && room >= 0; j++) { const ty = F.y0 + (room * j) / 8, tx = place(k, ty); if (tx !== null) { ok = { k, tx, ty }; break; } }
    if (ok) { best = ok; lo = k; } else hi = k;
  }
  if (!best) { const k = (F.x1 - 48) / (bx1 - bx0) * 0.5; best = { k, tx: F.x1 - (bx1 - bx0) * k, ty: F.y0 }; }
  const k = best.k * 0.96, w = innerWidth / k, h = innerHeight / k;
  // centre the slack: shift right by half the room left between the legal left edge and x1
  const slack = Math.max(0, F.x1 - (best.tx + (bx1 - bx0) * best.k)) / 2;
  const sx = best.tx + slack + (bx1 - bx0) * (best.k - k) / 2, sy = best.ty + (by1 - by0) * (best.k - k) / 2;
  return { M, x: bx0 - sx / k, y: by0 - sy / k, w, h };
}
let lastSecTick = -1, owed = true;
let fitW = 0, cur = null, lastYaw = null, lastPitch = null, detail = 1;

function loop(now) {
  const dt = last ? Math.min((now - last) / 1000, 0.05) : 0; last = now;
  clock += dt; frameNo++;
  const p = scrollP(); lastP = p;
  // scrolling during the intro hurries it along instead of cutting it
  const HOLD = 1.3;
  if (title) { title.style.setProperty("--p", Math.min(1, clock / HOLD).toFixed(3)); if (clock > HOLD && !title.classList.contains("gone")) title.classList.add("gone"); }
  if (intro < ASSEMBLY_END && (clock > HOLD || reduce)) intro = Math.min(ASSEMBLY_END, intro + dt * (p > 0.002 ? 3 : 1));
  const target = intro < ASSEMBLY_END ? intro : ASSEMBLY_END + p * (DURATION - ASSEMBLY_END);
  tShown = reduce || intro < ASSEMBLY_END ? target : tShown + (target - tShown) * (1 - Math.exp(-dt / 0.16));
  fireEvents(tPrev, tShown); tPrev = tShown;
  const s = { ...atFramed(tShown), t: tShown, clock };
  const ch = chapterAt(tShown, s.sec), live = tShown >= ASSEMBLY_END - 0.5;
  // at the end the camera circles the whole system, then returns when you scroll back
  orbitW += ((ch === "end" && !reduce ? 1 : 0) - orbitW) * (1 - Math.exp(-dt / 0.9));
  orbit += dt * 11 * orbitW;
  if (orbitW < 0.02) orbit += ((((-orbit % 360) + 540) % 360) - 180) * (1 - Math.exp(-dt / 0.5));
  s.yaw += orbit; s.pitch += 7 * orbitW;
  // the scene leans toward the pointer (no idle breathing: a still frame costs nothing)
  if (!reduce) {
    ex += (mx - ex) * (1 - Math.exp(-dt / 0.45)); ey += (my - ey) * (1 - Math.exp(-dt / 0.45));
    s.yaw += ex * 7; s.pitch += -ey * 4;
  }
  // after the light arrives the camera frames the whole system in the free space; the flash covers the change
  const lit = typeof PAINT !== "undefined" && PAINT && tShown >= PAINT.tLight;
  fitW += ((lit ? 1 : 0) - fitW) * (1 - Math.exp(-dt / 0.35));
  if (fitW > 0.001) {
    const camera = viewOf(s), fit = fitView(s), e = fitW;
    const want = { M: fit.M, x: camera.x + (fit.x - camera.x) * e, y: camera.y + (fit.y - camera.y) * e, w: camera.w + (fit.w - camera.w) * e, h: camera.h + (fit.h - camera.h) * e };
    if (!cur) cur = want;
    const f = 1 - Math.exp(-dt / 0.22);
    cur = { M: want.M, x: cur.x + (want.x - cur.x) * f, y: cur.y + (want.y - cur.y) * f, w: cur.w + (want.w - cur.w) * f, h: cur.h + (want.h - cur.h) * f };
    s.view = cur;
  } else cur = null;
  // fine lines fade while the camera turns fast or parts are flying; the kit skips them below 1%
  const omega = lastYaw === null || !dt ? 0 : Math.hypot(s.yaw - lastYaw, s.pitch - lastPitch) / dt;
  const flying = intro < ASSEMBLY_END && (s.build ?? 1) < 0.5;
  const want = flying ? 0.25 : 1 - Math.min(1, Math.max(0, (omega - 40) / 120));
  detail += (want - detail) * (1 - Math.exp(-dt / 0.25)); s.detail = detail;
  // redraw the parts only when the picture moves; slow machines redraw every other frame,
  // and a skipped frame stays owed, so the last position of a move is always drawn
  const moved = lastYaw === null || Math.abs(s.yaw - lastYaw) > 1e-3 || Math.abs(s.pitch - lastPitch) > 1e-3 || intro < ASSEMBLY_END || Math.abs(target - tShown) > 1e-3;
  const slow = setMs > 14;
  if (moved) owed = true;
  const redraw = owed && (!slow || frameNo % 2 === 0);
  if (redraw) owed = false;
  lastYaw = s.yaw; lastPitch = s.pitch;
  applyState(s, redraw || frameNo < 3);
  ui.dataset.theme = root.dataset.theme;
  for (const b of beats) { const key = b.dataset.show; b.classList.toggle("on", key === ch || (key === "live" && live) || (key === "cue" && ch === "hero" && p < 0.01)); }
  for (const r of rail) r.classList.toggle("on", r.dataset.ch === ch || (ch === "assembling" && r.dataset.ch === "hero"));
  const st = stationsAt(s.sec);
  if (live) { const txt = "second <b>" + Math.floor(s.sec) + "</b><br>" + ["lb", "app-1", "app-2", "db"].map((id) => id + " " + (st[id].dead ? "<b style=color:#d4524f>failed</b>" : "<b>" + st[id].rps + "</b> rps")).join(" · "); if (readout.innerHTML !== txt) readout.innerHTML = txt; }
  // a soft tick for each recorded second that passes
  if (live) { const k = Math.floor(s.sec); if (k !== lastSecTick) { if (lastSecTick >= 0) Sound.tick(); lastSecTick = k; } } else lastSecTick = -1;
  updateCard(s.sec, live && root.dataset.theme === "light");
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
`;

const page = k.pageHtml({ title: "InfraForge", theme: "light", body, script: turnScript() + LIVE, width: 960 });
writeFileSync(join(OUTPUT, "index.html"), page);

console.log(`wrote hero.html · ${(page.length / 1024).toFixed(0)} KB · ${S.out.report.parts} parts`);
