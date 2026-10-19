// The Learning site, v2: a journey, not a report. Same system as Engineering (colours,
// type, the bench), but a different shape: it opens with a question you answer, the
// challenges are stations on a cable, concepts are cards you flip, the interview is a
// conversation. Warmer, second person, centred where Engineering is a strict grid.
// Writes sections/learning-site.html.
//
// usage: node sections/learning2.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN, at, firstAt, fmt, bar, footer, page } from "./site.mjs";
import { miniHtml, miniCss, exploreJs } from "./explorable.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("Usage: node sections/learning2.mjs <output-directory>");
mkdirSync(OUTPUT, { recursive: true });
const s59 = at(59), s60 = at(60), s61 = at(61), s63 = at(63);
const app1Full = firstAt("app-1", (r) => r[1] >= 100);
const seconds = RUN.points.length;

// the challenges in the product today (apps/backend/challenges/definitions)
const LEVELS = [
  ["Starter", "Your first system online", [
    ["First production API", "Put a small API online behind a load balancer and keep it healthy under steady traffic.", "Load balancing"],
    ["Secure the edge", "An inherited design works, but exposes more than it should. Close the gaps without breaking it.", "Network exposure"]]],
  ["Core", "When something goes wrong", [
    ["Lose an app server", "One of two app servers crashes under steady traffic. Keep the rest of the system out of saturation.", "Redundancy · saturation"],
    ["Cache matters", "A read-heavy API overwhelms its database. Relieve it without buying the biggest instance.", "Caching"],
    ["Headroom under CPU pressure", "A CPU spike lands on app-2 for 20 seconds. Leave enough headroom to stay out of saturation.", "Headroom"],
    ["Write-heavy workload", "Most traffic writes data. Find out what a cache can and cannot do for you.", "Reads vs writes"]]],
  ["Advanced", "Systems under real pressure", [
    ["When the cache fails", "The cache crashes, and the database has to cope on its own.", "Dependency failure"],
    ["After the cache returns", "The fault ends, but the system doesn't snap back. Watch what recovers, and when.", "Recovery"],
    ["Survive the peak", "Traffic doubles in short bursts. The evaluation lands inside one of them.", "Burst traffic"],
    ["Scale out safely", "More app servers should help, until each one opens its own database connections.", "Connection limits"]]],
];
const CONCEPTS = [
  ["Load balancing", "Spreading requests across servers, and deciding what to do when one stops answering.", "First production API"],
  ["Redundancy", "Two servers aren't automatically safe. The one left standing must carry the full load.", "Lose an app server"],
  ["Saturation", "The moment a component is fully busy. After it, requests wait in line.", "Lose an app server"],
  ["Headroom", "The spare capacity you keep so a spike or a failure doesn't push you over.", "Headroom under CPU pressure"],
  ["Caching", "Answering repeat reads without touching the database.", "Cache matters"],
  ["Dependency failure", "What happens to everything behind a component when it disappears.", "When the cache fails"],
  ["Recovery", "Why a system doesn't snap back the moment a fault ends.", "After the cache returns"],
  ["Reads vs writes", "Why a cache helps reads, and what it can't do for writes.", "Write-heavy workload"],
  ["Burst traffic", "Designing for the peak, not the average.", "Survive the peak"],
  ["Connection limits", "Why adding servers can hurt the database they all connect to.", "Scale out safely"],
];

const css = `
${miniCss}
.c { text-align: center; } .c .lead { margin-left: auto; margin-right: auto; }
.l-sec { padding-top: 132px; padding-bottom: 132px; border-bottom: 1px solid var(--rule); }
.l-sec.band { background: var(--band); }
.l-head { max-width: 760px; margin: 0 auto 72px; text-align: center; }
.l-head h2 { margin: 16px 0 0; font-weight: 600; font-size: clamp(30px, 3.4vw, 48px); line-height: 1.1; letter-spacing: -.028em; text-wrap: balance; }
.l-head .lead { margin: 20px auto 0; }

/* opening: a question you answer */
.q-open .wrap { display: grid; grid-template-columns: 5fr 7fr; gap: 4vw; align-items: center; min-height: calc(100vh - 68px); min-height: calc(100dvh - 68px); padding-top: 64px; padding-bottom: 64px; }
.q-open h1 { margin: 20px 0 0; font-weight: 600; font-size: clamp(34px, 3.8vw, 54px); line-height: 1.08; letter-spacing: -.03em; text-wrap: balance; }
.q-open .lead { margin-top: 18px; }
.pick { display: grid; gap: 10px; margin-top: 34px; max-width: 520px; }
.pick button { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 28px 1fr; gap: 12px; align-items: center; padding: 16px 18px; border: 1px solid var(--rule2); border-radius: 14px; background: var(--card); font-size: 16px; color: var(--ink); transition: border-color .2s, transform .2s; }
.pick button:hover { border-color: var(--ink3); transform: translateX(3px); }
.pick button b { font: 500 12px/1 GeistMono, monospace; color: var(--ink3); }
.pick[data-done] button { cursor: default; transform: none; }
.pick[data-done] button.right { border-color: var(--accent); box-shadow: inset 4px 0 0 var(--accent); }
.pick[data-done] button.picked:not(.right) { border-color: var(--dead); }
.pick[data-done] button:not(.right):not(.picked) { opacity: .4; }
.verdict { max-width: 520px; margin-top: 22px; font-size: 16px; color: var(--ink2); min-height: 6em; }
.verdict strong { color: var(--ink); font-weight: 600; }
.verdict .num { font-size: 14px; }
.verdict .btns { margin-top: 18px; }
.verdict[hidden] { display: block; visibility: hidden; }
.watch { position: relative; margin-right: -3vw; }
.watch .note { margin-top: 10px; text-align: right; }

/* how you'll learn: three stops on one line */
.stops { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4vw; padding-top: 44px; }
.stops::before { content: ""; position: absolute; left: 16.6%; right: 16.6%; top: 11px; border-top: 2px dashed var(--rule2); }
.stop { position: relative; text-align: center; display: grid; gap: 12px; justify-items: center; }
.stop i { position: absolute; top: -44px; width: 24px; height: 24px; border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); }
.band .stop i { background: var(--band); }
.stop .n { font: 500 12px/1 GeistMono, monospace; color: var(--accent-ink); letter-spacing: .1em; }
.stop h3 { margin: 0; font-weight: 600; font-size: 24px; letter-spacing: -.02em; }
.stop p { color: var(--ink2); max-width: 26em; }

/* the path: challenges as stations on a cable */
.path { position: relative; max-width: 1040px; margin: 0 auto; }
.path .cable { position: absolute; left: 50%; top: 0; bottom: 0; width: 10px; transform: translateX(-50%); }
.path .cable svg { width: 100%; height: 100%; display: block; }
.path .cable .bead { stroke: var(--accent); stroke-width: 6; stroke-linecap: round; stroke-dasharray: 0.1 12; animation: flow 1.6s linear infinite; }
.path .cable .core { stroke: var(--rule2); stroke-width: 2; }
@keyframes flow { to { stroke-dashoffset: -12.1; } }
@media (prefers-reduced-motion: reduce) { .path .cable .bead { animation: none; } }
.level { position: relative; display: flex; justify-content: center; padding: 34px 0 26px; }
.level span { position: relative; z-index: 1; display: inline-flex; gap: 10px; align-items: baseline; padding: 10px 18px; border-radius: 999px; background: var(--ink); color: var(--bg); font-weight: 600; font-size: 15px; }
.level span small { font: 400 12px/1 GeistMono, monospace; opacity: .7; }
.station { position: relative; display: grid; grid-template-columns: 1fr 64px 1fr; align-items: center; padding: 18px 0; }
.station .dot { justify-self: center; z-index: 1; width: 18px; height: 18px; border-radius: 50%; background: var(--bg); border: 2px solid var(--ink); }
.band .station .dot { background: var(--band); }
.station .txt { max-width: 420px; }
.station:nth-of-type(odd) .txt { grid-column: 1; justify-self: end; text-align: right; }
.station:nth-of-type(odd) .dot { grid-column: 2; grid-row: 1; }
.station:nth-of-type(even) .txt { grid-column: 3; }
.station:nth-of-type(even) .dot { grid-column: 2; grid-row: 1; }
.station h3 { margin: 0; font-weight: 600; font-size: 19px; letter-spacing: -.01em; }
.station p { margin-top: 6px; color: var(--ink2); font-size: 15.5px; }
.station em { display: inline-block; margin-top: 10px; font: 500 11.5px/1 GeistMono, monospace; font-style: normal; letter-spacing: .06em; color: var(--accent-ink); }

/* concepts: cards you flip */
.cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.flip { all: unset; cursor: pointer; perspective: 900px; height: 210px; display: block; }
.flip .in { display: block; position: relative; width: 100%; height: 100%; transition: transform .6s cubic-bezier(.2,.7,.2,1); transform-style: preserve-3d; }
.flip[aria-pressed="true"] .in { transform: rotateY(180deg); }
.flip .f, .flip .b { position: absolute; inset: 0; backface-visibility: hidden; border: 1px solid var(--rule2); border-radius: 16px; background: var(--card); padding: 20px; display: grid; align-content: space-between; text-align: left; }
.flip .b { transform: rotateY(180deg); background: var(--ink); color: var(--bg); border-color: var(--ink); }
.flip .f b { display: block; font-weight: 600; font-size: 20px; letter-spacing: -.015em; }
.flip .f h3 { margin: 0; font-weight: 600; font-size: 20px; letter-spacing: -.015em; }
.flip .f span, .flip .b span { font: 500 11px/1.4 GeistMono, monospace; letter-spacing: .06em; opacity: .6; }
.flip .b p { font-size: 15px; line-height: 1.5; }
.flip:focus-visible .f { outline: 2px solid var(--accent); outline-offset: 2px; }

/* the interview, as a conversation */
.talk { max-width: 760px; margin: 0 auto; display: grid; gap: 26px; }
.say { display: grid; grid-template-columns: 120px 1fr; gap: 24px; align-items: baseline; }
.say .who { font: 500 11.5px/1.6 GeistMono, monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--ink3); text-align: right; }
.say p { font-size: 19px; line-height: 1.55; color: var(--ink); }
.say.you p { color: var(--ink); } .say.them p { color: var(--ink2); }
.say.you .who { color: var(--accent-ink); }
.say .num { font-size: 16px; }

/* honesty: three short promises */
.promises { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4vw; max-width: 1040px; margin: 0 auto; }
.promises div { border-top: 2px solid var(--ink); padding-top: 20px; }
.promises h3 { margin: 0; font-weight: 600; font-size: 19px; }
.promises p { margin-top: 8px; color: var(--ink2); font-size: 15.5px; }

/* questions: open, two columns */
.qa { max-width: 1040px; margin: 0 auto; border-top: 1px solid var(--rule); }
.qa div { display: grid; grid-template-columns: 5fr 7fr; gap: 4vw; padding: 28px 0; border-bottom: 1px solid var(--rule); }
.qa h3 { margin: 0; font-weight: 600; font-size: 18px; letter-spacing: -.01em; }
.qa p { color: var(--ink2); }

.l-close { padding-top: 168px; padding-bottom: 168px; border-bottom: 1px solid var(--rule); text-align: center; }
.l-close h2 { margin: 0 auto; max-width: 15em; font-weight: 600; font-size: clamp(32px, 3.6vw, 52px); line-height: 1.08; letter-spacing: -.03em; text-wrap: balance; }
.l-close .btns { justify-content: center; margin-top: 36px; }
@media (max-width: 980px) {
  .q-open .wrap, .stops, .promises, .qa div { grid-template-columns: 1fr; } .stops::before { display: none; } .stop i { position: static; }
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .path .cable { left: 12px; } .station { grid-template-columns: 24px 1fr; } .station .txt, .station:nth-of-type(odd) .txt { grid-column: 2; justify-self: start; text-align: left; } .station .dot, .station:nth-of-type(odd) .dot, .station:nth-of-type(even) .dot { grid-column: 1; }
  .level { justify-content: flex-start; } .say { grid-template-columns: 1fr; gap: 6px; } .say .who { text-align: left; }
}`;

const body = `
${bar("Learning", [["path", "The path"], ["concepts", "Concepts"], ["interview", "Interviews"], ["questions", "Questions"]])}
<main>
<section class="q-open"><div class="wrap">
  <div>
    <div class="mono">Your first lesson · 30 seconds</div>
    <h1>A server dies. What happens to the one left standing?</h1>
    <p class="lead">Two app servers share the traffic, each at about ${Math.round(s59["app-1"].cpu)}% CPU. At second ${RUN.fault.at}, app-2 crashes. Pick what you think happens to app-1, then watch the recording decide.</p>
    <div class="pick" role="group" aria-label="Your prediction">
      <button type="button"><b>A</b>It barely notices. The balancer sheds the extra load.</button>
      <button type="button" data-right><b>B</b>Its traffic doubles and it runs out of CPU.</button>
      <button type="button"><b>C</b>Nothing changes. It was only at ${Math.round(s59["app-1"].cpu)}%.</button>
    </div>
    <div class="verdict" hidden aria-live="polite"><p class="say-it"></p><p style="margin-top:10px">From the recording: app-1 goes from <span class="num">${s60["app-1"].rps} → ${s61["app-1"].rps} rps</span> and reaches <span class="num">${fmt(s63["app-1"].cpu)}% CPU</span> by second ${app1Full}. Two servers at ${Math.round(s59["app-1"].cpu)}% looked comfortable; one server at double the load is not.</p>
      <div class="btns"><a class="btn primary" href="/challenges">Start learning</a><a class="link" href="#path">See the whole path</a></div></div>
  </div>
  <div class="watch">${miniHtml(55)}<p class="note mono">The recorded run · ${RUN.challenge.title}</p></div>
</div></section>

<section class="l-sec band"><div class="wrap">
  <div class="l-head"><div class="mono">How you'll learn</div><h2>You just did it. That's every challenge.</h2><p class="lead">You guessed, the system ran, and the recording showed you why. Each challenge is that loop, on a different system.</p></div>
  <div class="stops">
    <div class="stop"><i></i><span class="n">01</span><h3>Predict</h3><p>Before anything runs, say what you think will happen. Being wrong is useful.</p></div>
    <div class="stop"><i></i><span class="n">02</span><h3>Run</h3><p>The system plays ${seconds} recorded seconds of real traffic, with its faults on schedule.</p></div>
    <div class="stop"><i></i><span class="n">03</span><h3>Understand</h3><p>See what happened in order, with the number behind each step, and where it differed from your guess.</p></div>
  </div>
</div></section>

<section class="l-sec" id="path"><div class="wrap">
  <div class="l-head"><div class="mono">The path</div><h2>Ten challenges, from your first API to scaling safely.</h2><p class="lead">Follow the cable from the top. Each stop is a real system with a recorded run.</p></div>
  <div class="path"><div class="cable" aria-hidden="true"><svg preserveAspectRatio="none" viewBox="0 0 10 1000"><line class="core" x1="5" x2="5" y1="0" y2="1000"/><line class="bead" x1="5" x2="5" y1="0" y2="1000" vector-effect="non-scaling-stroke"/></svg></div>
    ${LEVELS.map(([lv, sub, items]) => `<div class="level"><span>${lv}<small>${sub}</small></span></div><div class="stations">${items.map(([t, d, c]) => `<div class="station"><div class="txt"><h3>${t}</h3><p>${d}</p><em>${c}</em></div><span class="dot"></span></div>`).join("")}</div>`).join("")}
  </div>
</div></section>

<section class="l-sec band" id="concepts"><div class="wrap">
  <div class="l-head"><div class="mono">Concepts</div><h2>The ideas behind every system design question.</h2><p class="lead">Tap a card. Each idea is taught by a challenge where you watch it happen.</p></div>
  <div class="cards">${CONCEPTS.map(([t, d, ch]) => `<button class="flip" type="button" aria-pressed="false"><span class="in"><span class="f"><b>${t}</b><span>Tap to explain</span></span><span class="b"><p>${d}</p><span>${ch}</span></span></span></button>`).join("")}</div>
</div></section>

<section class="l-sec" id="interview"><div class="wrap">
  <div class="l-head"><div class="mono">For interviews</div><h2>Answer “what happens when it fails?” with something you've seen.</h2></div>
  <div class="talk">
    <div class="say them"><span class="who">Interviewer</span><p>Your service runs on two app servers behind a load balancer. One dies at peak. What happens?</p></div>
    <div class="say you"><span class="who">You</span><p>The survivor takes all of it. In the run I watched, it went from <span class="num">${s60["app-1"].rps}</span> to <span class="num">${s61["app-1"].rps}</span> requests a second in one second, and hit <span class="num">${fmt(s63["app-1"].cpu)}%</span> CPU by second ${app1Full}.</p></div>
    <div class="say them"><span class="who">Interviewer</span><p>So how would you size it?</p></div>
    <div class="say you"><span class="who">You</span><p>For one server down, not for the average. Each server needs room for the whole load, or I add a third so the survivors share it.</p></div>
  </div>
</div></section>

<section class="l-sec band"><div class="wrap">
  <div class="l-head"><div class="mono">What's true here</div><h2>Nothing on the screen is made up.</h2></div>
  <div class="promises">
    <div><h3>Recorded, second by second</h3><p>Load, CPU, memory and health come from the run itself, for every part and every second.</p></div>
    <div><h3>Unknown is never zero</h3><p>If something wasn't measured, you'll see “unknown”, never a calm flat line.</p></div>
    <div><h3>The same run every time</h3><p>Traffic and faults replay exactly, so you can change one thing and compare.</p></div>
  </div>
</div></section>

<section class="l-sec" id="questions"><div class="wrap">
  <div class="l-head"><div class="mono">Questions</div><h2>What learners ask first.</h2></div>
  <div class="qa">
    <div><h3>Do I need to know distributed systems already?</h3><p>No. The starter challenges assume you know what a server and a database are. Each challenge explains the ideas it uses.</p></div>
    <div><h3>Is it a game or a real system?</h3><p>A simulation of a real system. Every part behaves the way the real one does under load, and every number is recorded from the run.</p></div>
    <div><h3>What if my prediction is wrong?</h3><p>That's the point. Your guess is kept separate from the result, so you see exactly where your picture of the system was off.</p></div>
    <div><h3>How long does a challenge take?</h3><p>Each run is ${seconds} recorded seconds. Most people spend a few minutes predicting, running and reviewing.</p></div>
    <div><h3>What does it cost?</h3><p>It is free during early access.</p></div>
  </div>
</div></section>

<section class="l-close"><div class="wrap">
  <div class="mono">Start</div>
  <h2 style="margin-top:18px">Your next prediction is one click away.</h2>
  <div class="btns"><a class="btn primary" href="/challenges">Start learning</a><a class="link" href="/engineering">Or replicate your own system</a></div>
</div></section>
</main>
${footer("Learning")}`;

const js = `<script>
(() => {
  const pick = document.querySelector(".pick"), verdict = document.querySelector(".verdict");
  for (const b of pick.querySelectorAll("button")) b.addEventListener("click", () => {
    if (pick.dataset.done) return; b.classList.add("picked"); pick.dataset.done = "1";
    for (const o of pick.querySelectorAll("button")) if (o.hasAttribute("data-right")) o.classList.add("right");
    const right = b.hasAttribute("data-right");
    verdict.querySelector(".say-it").innerHTML = right ? "<strong>You called it.</strong> Watch the bench: app-2 goes dark and app-1 takes everything." : "<strong>Not quite, and that's the useful part.</strong> Watch the bench: app-2 goes dark and app-1 takes everything.";
    verdict.hidden = false;
    if (window.IFBench) window.IFBench.playTo(56, 70, 2.5);
  });
  for (const f of document.querySelectorAll(".flip")) f.addEventListener("click", () => f.setAttribute("aria-pressed", String(f.getAttribute("aria-pressed") !== "true")));
})();
</script>`;

let html = page({
  title: "Learn distributed systems by watching them fail · InfraForge",
  description: "Learn load balancing, caching, failover and scaling by predicting what a system will do, running it under recorded traffic and seeing exactly why it broke.",
  accent: { light: "#d9a854", lightInk: "#8a6420", onLight: "#1a1714", dark: "#e3b664" },
  body,
});
html = html.replace("</style>", css + "</style>").replace("</body>", exploreJs + js + "</body>");
writeFileSync(join(OUTPUT, "learning.html"), html);
console.log("wrote learning-site.html", Math.round(html.length / 1024) + " KB");
