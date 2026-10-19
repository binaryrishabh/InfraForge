// The Engineering site: one long, calm page for engineers who replicate their
// infrastructure before they ship. Writes sections/engineering-site.html.
//
// usage: node sections/engineering-site.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUN, at, series, firstAt, fmt, bar, bench, secHead, caption, faq, footer, lineChart, spark, page } from "./site.mjs";
import { exploreCss, exploreHtml, exploreJs } from "./explorable.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = process.argv[2];
if (!OUTPUT) throw new Error("Usage: node sections/engineering-site.mjs <output-directory>");
mkdirSync(OUTPUT, { recursive: true });
const s59 = at(59), s60 = at(60), s61 = at(61), s62 = at(62), s63 = at(63), s64 = at(64);
const app1Full = firstAt("app-1", (r) => r[1] >= 100);
const dbHot = firstAt("db", (r) => r[0] >= 2);
const seconds = RUN.points.length;
const workload = RUN.workload.replace(/\.$/, "");
const nullDead = (id) => RUN.points.map((p) => { const r = p.resources[["dns", "lb", "app-1", "app-2", "db"].indexOf(id)]; return r[0] >= 3 ? null : r[1]; });

const body = `
${bar("Engineering", [["how", "How it works"], ["run", "A recorded run"], ["replicate", "What you can replicate"], ["questions", "Questions"]])}
<main>
<section class="open"><div class="wrap">
  <div>
    <div class="mono">InfraForge for engineers</div>
    <h1>Know where your system breaks, before your users find out.</h1>
    <p class="lead">Replicate the infrastructure you run, play real recorded traffic through it, and see which part gives out first, the second it happens, and what it takes down with it.</p>
    <div class="btns"><a class="btn primary" href="/design">Open the canvas</a><a class="btn" href="#run">See a recorded run <small>${seconds} s</small></a></div>
    <div class="meta"><div><span class="mono">Load</span><b>${workload.split(", ")[0]}</b></div><div><span class="mono">Fault</span><b>app-2 crashes at ${RUN.fault.at}s</b></div></div>
  </div>
  <figure>${bench("engineer")}</figure>
</div></section>

<section class="sec"><div class="wrap">
  ${secHead("problem", "01 · The problem", "A load test tells you it got slow. It doesn't tell you why.", "Dashboards show symptoms after the fact. Diagrams show what you meant to build. Neither shows how this exact system behaves when a server dies at the worst possible moment.", `<div class="prose">
    <p>Most capacity decisions are made from a mix of vendor numbers, a load test against staging, and experience. That works until the failure you didn't test for. Then the questions start: which part saturated first? Was it the server that died, or the one that took its traffic? Did the database slow everything else down?</p>
    <p>InfraForge answers those questions <b>before you ship</b>. You rebuild your system as it really is, play a recording of real traffic through it, inject the failure you're worried about, and read what happened second by second. Nothing is estimated after the fact; every number on the screen is the recorded value at that second.</p>
  </div>`)}
</div></section>

<section class="sec band" id="how"><div class="wrap">
  ${secHead("how-it-works", "02 · How it works", "Replicate, replay, read.", "Three steps, each one honest about what it knows. If a value wasn't recorded, InfraForge shows it as unknown, never as zero.")}
  <div class="rows">
    <div class="row"><div><div class="n">01</div><h3>Replicate the system you actually run.</h3></div><p>Place a load balancer, app servers and a database. Size each one, connect them the way traffic really flows, and set the limits you have in production.</p>
      <table class="table" style="font-size:14px"><tbody><tr><td>lb</td><td>Load balancer</td></tr><tr><td>app-1, app-2</td><td>2 × virtual machine</td></tr><tr><td>db</td><td>Database</td></tr></tbody></table></div>
    <div class="row"><div><div class="n">02</div><h3>Replay real recorded traffic.</h3></div><p>${workload}, applied second by second. Then inject the fault you're worried about: here, app-2 crashes at second ${RUN.fault.at} and stays down for ${RUN.fault.duration} seconds.</p>
      ${spark({ values: series("lb", 2), color: "var(--ink)", yMax: 140 })}</div>
    <div class="row"><div><div class="n">03</div><h3>Read where it broke, and why.</h3></div><p>Every component reports its load, CPU and health every second. When something fails, you get the chain of events that led to it, read straight from the recording.</p>
      <div class="node" style="--c:var(--hot)"><div class="h"><b>app-1</b><span>saturated</span></div><dl><dt>Requests</dt><dd>${s64["app-1"].rps} rps</dd><dt>CPU</dt><dd>${fmt(s64["app-1"].cpu)}%</dd><dt>Full since</dt><dd>second ${app1Full}</dd></dl><p>app-2 crashed at second ${RUN.fault.at}; the balancer sent app-1 its share too.</p></div></div>
  </div>
</div></section>

<section class="sec" id="run"><div class="wrap">
  ${secHead("a-recorded-run", "03 · A recorded run", "Ninety seconds, one crash, every second on the record.", `The run below is the challenge “${RUN.challenge.title}”: ${workload.toLowerCase()}. Scrub through it and watch the bench.`)}
  <figure class="fig" style="border-top:0;padding-top:0">${exploreHtml(60)}
  ${caption("Fig. 1 · The recorded run, live", `Drag along the chart or press play. The bench shows that exact second: lamps, traffic on the cables, the failed server. Before the crash, app-1 and app-2 share the load at about ${Math.round(s59["app-1"].cpu)}% CPU each; one second after app-2 stops, app-1 is at ${fmt(s61["app-1"].cpu)}%, and by second ${app1Full} it is at ${fmt(s63["app-1"].cpu)}%.`)}</figure>
  <figure class="fig"><div class="multi">
    ${[["lb", "Load balancer"], ["app-1", "app-1"], ["app-2", "app-2"], ["db", "Database"]].map(([id, name]) => `<div class="m"><div class="t"><span>${name}</span><b>${s59[id].rps} → ${s64[id].rps} rps</b></div>${spark({ values: series(id, 2), color: id === "app-1" ? "var(--accent)" : "var(--ink)", yMax: 170 })}</div>`).join("")}
  </div>${caption("Fig. 2 · Requests per second", `Traffic into the balancer never changes at the crash: it stays at ${s60.lb.rps} rps. What changes is where it goes. app-2 drops to zero and app-1 takes all ${s61["app-1"].rps}.`)}</figure>
</div></section>

<section class="sec band" id="why"><div class="wrap">
  ${secHead("why-it-broke", "04 · Why it broke", "The server that died wasn't the one that failed the test.", "app-2 crashing was the experiment. The real finding is what the remaining system did next.")}
  <div class="sec-body split">
    <figure>${bench("late")}${caption("Fig. 3 · Second 70", "app-2 is down; app-1 and the database are both running hot.")}</figure>
    <ol class="chain">
      <li><div class="t"><i style="--c:var(--ink3)"></i>${RUN.fault.at - 1}s</div><div><h4>Two servers, plenty of room</h4><p>The balancer sends ${s59["app-1"].rps} rps to each app server. Both sit near ${Math.round(s59["app-1"].cpu)}% CPU.</p></div></li>
      <li><div class="t"><i style="--c:var(--dead)"></i>${RUN.fault.at}s</div><div><h4>app-2 crashes</h4><p>Its process stops. From the next second it answers nothing and its cables drain.</p></div></li>
      <li><div class="t"><i style="--c:var(--hot)"></i>61s</div><div><h4>app-1 takes everything</h4><p>Its traffic doubles from ${s60["app-1"].rps} to ${s61["app-1"].rps} rps and its CPU jumps to ${fmt(s61["app-1"].cpu)}% in one second.</p></div></li>
      <li><div class="t"><i style="--c:var(--hot)"></i>${dbHot}s</div><div><h4>The database runs hot</h4><p>Its CPU reaches ${fmt(s62.db.cpu)}% at ${s62.db.rps} rps.</p></div></li>
      <li><div class="t"><i style="--c:var(--hot)"></i>${app1Full}s</div><div><h4>app-1 is saturated</h4><p>CPU hits ${fmt(s63["app-1"].cpu)}%. One server was never enough for this traffic; two only looked like it.</p></div></li>
    </ol>
  </div>
</div></section>

<section class="sec" id="replicate"><div class="wrap">
  ${secHead("what-you-can-replicate", "05 · What you can replicate", "Start with the parts every system has.", "Each component behaves like the real one under load: it saturates, queues, fails and recovers. New components arrive only once they are realistic.")}
  <div class="table-wrap"><table class="table"><thead><tr><th>Component</th><th>What is modelled</th><th>Status</th></tr></thead><tbody>
    <tr><td>Load balancer</td><td>How requests are split across targets, and where they go when a target stops answering.</td><td><span class="st" style="--c:var(--ok)"><i></i>Available</span></td></tr>
    <tr><td>App servers</td><td>Requests, CPU and memory on each instance, every second, sized like real machine types.</td><td><span class="st" style="--c:var(--ok)"><i></i>Available</span></td></tr>
    <tr><td>Database</td><td>Query load and CPU, and the second it saturates.</td><td><span class="st" style="--c:var(--ok)"><i></i>Available</span></td></tr>
    <tr><td>Cache</td><td>What it absorbs, and what reaches the database when it misses or fails.</td><td><span class="st" style="--c:var(--ok)"><i></i>Available</span></td></tr>
    <tr><td>Queues and workers</td><td>Backlog, consumers and retries.</td><td><span class="st" style="--c:var(--ink3)"><i></i>Planned</span></td></tr>
    <tr><td>Autoscaling groups</td><td>New instances, their warm-up time, and the config they inherit.</td><td><span class="st" style="--c:var(--ink3)"><i></i>Planned</span></td></tr>
    <tr><td>CDN and object storage</td><td>Edge hits, origin load and transfer.</td><td><span class="st" style="--c:var(--ink3)"><i></i>Planned</span></td></tr>
  </tbody></table></div>
</div></section>

<section class="sec band" id="measure"><div class="wrap">
  ${secHead("what-you-measure", "06 · What you measure", "Every second, for every component.", "These are the values InfraForge records. Anything it cannot measure yet is labelled as such, so you never mistake a gap for a zero.")}
  <div class="defs">
    <div><h4>Requests per second<small>Recorded</small></h4><p>How much traffic each component handles, and how it shifts when something fails.</p></div>
    <div><h4>CPU<small>Recorded</small></h4><p>How busy each component is. Sustained 100% means requests are waiting.</p></div>
    <div><h4>Memory<small>Recorded</small></h4><p>How much each instance holds, per second.</p></div>
    <div><h4>Health<small>Recorded</small></h4><p>Healthy, under pressure, saturated or failed, with the second it changed.</p></div>
    <div><h4>Latency p50 · p95 · p99<small>Coming with the new engine</small></h4><p>What a typical request, and your slowest requests, experience.</p></div>
    <div><h4>Monthly cost<small>Coming with the new engine</small></h4><p>What the setup costs per month at real provider prices, so you can weigh headroom against spend.</p></div>
  </div>
</div></section>

<section class="sec" id="faults"><div class="wrap">
  ${secHead("failures-you-can-inject", "07 · Failures you can inject", "Break it on purpose, on a timeline.", "Pick what fails, when, and for how long. The recording shows the rest of the system's response.")}
  <div class="table-wrap"><table class="table"><thead><tr><th>Failure</th><th>What happens</th><th>Where to see it</th></tr></thead><tbody>
    <tr><td>Server crash</td><td>The process stops; the balancer must route around it.</td><td>Lose an app server</td></tr>
    <tr><td>CPU pressure</td><td>Extra load lands on one server for a set time.</td><td>Headroom under CPU pressure</td></tr>
    <tr><td>Cache failure</td><td>The cache goes down and the database takes every read.</td><td>When the cache fails</td></tr>
    <tr><td>Traffic bursts</td><td>Load doubles in short bursts.</td><td>Survive the peak</td></tr>
  </tbody></table></div>
</div></section>

<section class="sec band" id="compare"><div class="wrap">
  ${secHead("compared", "08 · Where it fits", "Not a load test. Not a diagram.", "InfraForge sits between the tools you already use: it runs like a test, reads like a diagram, and explains like a post-mortem.")}
  <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Load testing</th><th>Diagram tools</th><th>InfraForge</th></tr></thead><tbody>
    <tr><td>Needs the real system running</td><td>Yes</td><td>No</td><td>No</td></tr>
    <tr><td>Shows behaviour under load</td><td>Yes</td><td>No</td><td>Yes, recorded per second</td></tr>
    <tr><td>Explains why something failed</td><td>No</td><td>No</td><td>Yes, as a chain of events</td></tr>
    <tr><td>Injects failures on a timeline</td><td>Sometimes</td><td>No</td><td>Yes</td></tr>
  </tbody></table></div>
</div></section>

<section class="sec" id="questions"><div class="wrap">
  ${secHead("questions-and-answers", "09 · Questions", "What engineers ask first.", "Short answers. The docs go deeper.")}
  ${faq([
    ["Is this a simulation or a real deployment?", "A simulation. Nothing is deployed to your cloud account. InfraForge models each component's behaviour under load and records every second, so you can study a failure without causing one."],
    ["Where does the traffic come from?", `From recorded workloads. The run on this page is ${workload.toLowerCase()}. The same recording is replayed every time, so runs are repeatable and comparable.`],
    ["How realistic are the numbers?", "Each value is recorded from the engine at that second, never filled in afterwards. Where a value isn't measured yet, such as latency percentiles today, it is shown as unknown rather than as zero."],
    ["Which clouds and components are supported?", "Load balancers, app servers, a database and a cache are available now. Queues, autoscaling groups, CDN and object storage are planned and will be added only when they are realistic."],
    ["Do I need to install anything?", "No. InfraForge runs in the browser."],
    ["What does it cost?", "It is free during early access."],
  ])}
</div></section>

<section class="close"><div class="wrap">
  <div class="mono">Start</div>
  <h2 style="margin-top:18px">Replicate one system you run, and break it on purpose.</h2>
  <p class="lead">It takes a few minutes to build. The recording takes ${seconds} seconds.</p>
  <div class="btns"><a class="btn primary" href="/design">Open the canvas</a><a class="link" href="/learning">Or start with a guided challenge</a></div>
</div></section>
</main>
${footer("Engineering")}`;

let html = page({
  title: "InfraForge for engineers: see where your system breaks before you ship",
  description: "Replicate your infrastructure, replay real recorded traffic, inject failures and see which component breaks first and why, second by second.",
  accent: { light: "#c0602a", lightInk: "#a8501f", onLight: "#fff7ef", dark: "#ec8a4c" },
  body,
});
html = html.replace("</style>", exploreCss + "</style>").replace("</body>", exploreJs + "</body>");
writeFileSync(join(OUTPUT, "engineering.html"), html);
console.log("wrote engineering-site.html", Math.round(html.length / 1024) + " KB");
