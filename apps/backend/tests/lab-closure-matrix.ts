/* Read-only lab completeness matrix for the labs added or changed since a base commit.
   bun --no-env-file apps/backend/tests/lab-closure-matrix.ts [--base 46f8a9f] [--labs id,id | --list] [--json]
   The lab list is derived from the tree: every challenge definition file and every lesson file under learning/content/<track>/lessons
   that differs between <base> and the working tree (git diff + untracked), mapped through the registries to challenge ids.
   Every verdict comes from the real product path used by the calibration tests: harness attemptRow (Model 2 engine, captured inputs,
   terminal capture) -> buildRunReport, with preflight and the design-change review. The hidden reference designs and the near-miss
   edits stay in tests/ (REFERENCE) and in the NEAR_MISS table below. Nothing is written or edited.
   A lab with no reference or no near-miss entry is printed as MISSING (never skipped silently). */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ChallengeDefinition, ChallengeStarter } from "@infraforge/contracts/challenges";
import { captureRunInputs } from "../deployments/runInputs";
import { reviewDesignChanges } from "../challenges/designChanges";
import { choicesFor } from "../challenges/prediction";
import { preflight } from "../challenges/preflight";
import { challengeSeed, REGISTRY, latestChallenge, specHash } from "../challenges/registry";
import { learningContent as content } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { buildRunReport } from "../reports/report";
import { REFERENCE, attemptRow } from "../tests/challengeHarness";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1]! : null;
const base = flag("--base") ?? "46f8a9f";
const backend = resolve(import.meta.dir, "..");
type Edit = (s: ChallengeStarter) => void;
const res = (s: ChallengeStarter, id: string) => s.resources.find((r) => r.id === id)!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const find = (s: ChallengeStarter, key: string): any => s.resources.find((r) => (r as any)[key])!;

/* The plausible wrong fix each lab's own debrief or hint names (the "near miss"), as one setting changed from the starter.
   `cue` must appear in the definition's story, hints or debrief (or else in the lesson text) for the near miss to count as the lab's
   pinned wrong fix. A new lab (for example cache-an-empty-answer) must add its entry here; until it does, the matrix prints MISSING. */
const NEAR_MISS: Record<string, { what: string; cue: RegExp; edit: Edit }> = {
  "admit-a-replica-image": { what: "app autoscaling maximum 4", cue: /maximum|more replicas|replica count|room for more/i, edit: (s) => { res(s, "app").autoscaling!.maxReplicas = 4; } },
  "bound-replica-staleness": { what: "read routing primary-only", cue: /primary only|reads back to the primary|primary/i, edit: (s) => { res(s, "db").databaseReadRouting = { version: 1, policy: "primary-only" }; } },
  "choose-a-retry-mitigation": { what: "Maximum attempts 5", cue: /test 5|5 separately|five attempts/i, edit: (s) => { res(s, "lb").retry!.maxAttempts = 5; } },
  "diagnose-lost-app-capacity": { what: "app size large", cue: /Enlarging app|bigger app|larger app|app size|larger instance|more app/i, edit: (s) => { res(s, "app").size = "large"; } },
  "fit-the-working-set": { what: "TTL 3600 (maximum), capacity unchanged", cue: /lengthen the TTL|longer TTL|TTL to its maximum/i, edit: (s) => { (res(s, "cache").cachePolicy as { ttlSeconds?: number }).ttlSeconds = 3600; } },
  "hold-slots-on-a-slow-call": { what: "worker size large", cue: /larger worker size|larger worker|bigger worker/i, edit: (s) => { res(s, "worker").size = "large"; } },
  "isolate-route-credits": { what: "writeApp size large", cue: /enlarge only writeApp|writeApp/i, edit: (s) => { res(s, "writeApp").size = "large"; } },
  "keep-a-function-warm": { what: "concurrent invocations 16", cue: /Concurrent invocations/i, edit: (s) => { find(s, "serverless").serverless.concurrency = 16; } },
  "keep-an-asset-cached": { what: "CDN TTL 10 s", cue: /10 seconds/i, edit: (s) => { res(s, "cdn").cdnCachePolicy!.ttlSeconds = 10; } },
  "keep-failed-events": { what: "bus max attempts 6", cue: /attempts|retries|delivery/i, edit: (s) => { res(s, "bus").eventBus!.maxAttempts = 6; } },
  "leave-room-for-firewall-flows": { what: "app SKU m5.2xlarge", cue: /bigger app|larger app|bigger instance|larger instance|m5\.2xlarge|more CPU|CPU/i, edit: (s) => { res(s, "app").skuId = "m5.2xlarge"; } },
  "notification-retry-storm": { what: "queue max receives 3", cue: /\b3\b|three/i, edit: (s) => { res(s, "queue").asyncQueue!.maxReceives = 3; } },
  "open-the-forwarding-gate": { what: "queued requests 4096", cue: /Queued requests/i, edit: (s) => { find(s, "lbAdmission").lbAdmission.maxQueued = 4096; } },
  "order-the-row-locks": { what: "database size large", cue: /database bigger|bigger database|larger database|database larger/i, edit: (s) => { res(s, "db").size = "large"; } },
  "redrive-after-the-fix": { what: "delivery limit 10", cue: /delivery limit|receives|limit/i, edit: (s) => { res(s, "queue").asyncQueue!.maxReceives = 10; } },
  "refresh-after-a-write": { what: "TTL 2 s with invalidation off", cue: /two seconds/i, edit: (s) => { (res(s, "cache").cachePolicy as { ttlSeconds?: number }).ttlSeconds = 2; } },
  "release-the-cpu-budget": { what: "active workers 64", cue: /Active workers from 8 to 64/i, edit: (s) => { find(s, "vmExecution").vmExecution.workers = 64; } },
  "resolve-after-publication": { what: "app size large", cue: /app size from small to large/i, edit: (s) => { res(s, "app").size = "large"; } },
  "restore-a-database-writer": { what: "promote at second 6", cue: /\b6\b|six/i, edit: (s) => { res(s, "db").databaseRecoveryPlan!.promoteAtSecond = 6; } },
  "reuse-before-expiry": { what: "capacity 512 entries, TTL 1 s", cue: /512/i, edit: (s) => { const c = res(s, "cache"); c.cachePolicy = { ...c.cachePolicy!, version: 2, capacityEntries: 512 } as typeof c.cachePolicy; } },
  "sample-often-enough": { what: "export interval 1 s", cue: /export interval/i, edit: (s) => { (res(s, "monitor").monitoringPolicy as { exportIntervalSeconds: number }).exportIntervalSeconds = 1; } },
  "scale-on-delivered-samples": { what: "target CPU 10 %", cue: /CPU target|lower target|target CPU|lower the target/i, edit: (s) => { res(s, "app").autoscaling!.targetCpu = 10; } },
  "serve-stale-on-error": { what: "database size large", cue: /bigger database|larger database|bigger db|database/i, edit: (s) => { res(s, "db").size = "large"; } },
  "set-the-limit-above-the-peak": { what: "burst 1000", cue: /burst to 1000/i, edit: (s) => { res(s, "lb").lbRateLimit!.burstRequests = 1000; } },
  "share-one-origin-fetch": { what: "CDN TTL 2 s with coalescing off", cue: /doubling.*TTL|TTL/i, edit: (s) => { res(s, "cdn").cdnCachePolicy!.ttlSeconds = 2; } },
  "shed-load-at-the-edge": { what: "app size large", cue: /larger app/i, edit: (s) => { res(s, "app").size = "large"; } },
  "trace-a-burst-backlog": { what: "worker size medium", cue: /faster worker|bigger worker|larger worker|worker size/i, edit: (s) => { res(s, "worker").size = "medium"; } },
  "trace-a-scaling-stall": { what: "autoscaling maximum 6", cue: /higher maximum|Raising the maximum/i, edit: (s) => { res(s, "app").autoscaling!.maxReplicas = 6; } },
  "trace-a-slowdown-cascade": { what: "cache capacity 12 (needs 16)", cue: /12|short of|just under|capacity/i, edit: (s) => { const c = res(s, "cache"); c.cachePolicy = { ...c.cachePolicy!, version: 2, capacityEntries: 12 } as typeof c.cachePolicy; } },
};

// ---- lab list: from the tree, not from a hard-coded list
const sh = (cmd: string[]) => { try { return execFileSync("git", ["-C", backend, ...cmd], { encoding: "utf8" }); } catch { return ""; } };
if (!sh(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).trim()) {
  if (!flag("--labs")) { console.error(`base ${base} is not in this checkout, so the lab list cannot be derived from the tree. Pass --labs id,id (print the list elsewhere with --list) or fetch the base.`); process.exit(2); }
}
const changed = new Set([...sh(["diff", "--name-only", base, "--", "challenges/definitions", "learning/content"]).split("\n"),
  ...sh(["ls-files", "--others", "--exclude-standard", "--", "challenges/definitions", "learning/content"]).split("\n")].map((f) => f.replace(/^apps\/backend\//, "")).filter(Boolean));
const labLessons = content.lessons.filter((l) => l.kind === "executable-lab");
const labIds = new Set<string>();
const why = new Map<string, Set<string>>();
const note = (id: string, text: string) => { labIds.add(id); (why.get(id) ?? why.set(id, new Set()).get(id)!).add(text); };
for (const file of changed) {
  const def = /challenges\/definitions\/([a-z0-9-]+)\/v(\d+)\.ts$/.exec(file);
  if (def && latestChallenge(def[1]!)) note(def[1]!, `challenge v${def[2]}`);
  const lesson = /learning\/content\/[a-z]+\/lessons\/([a-z0-9-]+?)(?:-v(\d+))?\.ts$/.exec(file);
  if (lesson) {
    const l = labLessons.find((x) => x.id === lesson[1]);
    if (l) note(l.experiment!.challengeId, `lesson ${lesson[1]}${lesson[2] ? ` v${lesson[2]}` : ""}`);
  }
}
const only = flag("--labs")?.split(",");
const labs = only ? only.filter((id) => latestChallenge(id)) : [...labIds].sort();
if (args.includes("--list")) { console.log(labs.join(",")); process.exit(0); }

// ---- helpers
const pick = (d: ChallengeDefinition, design: ChallengeStarter) => ({ answers: Object.fromEntries(d.predictions.map((q) =>
  [q.id, choicesFor(q.kind, [...new Set(design.resources.map((r) => r.type))], d.engine, design.resources.map((r) => r.id))[0]!])), reasoning: null });
type Report = ReturnType<typeof buildRunReport>;
type Criterion = NonNullable<Report["challenge"]>["criteria"][number];
const criteriaOf = (r: Report) => r.challenge?.criteria ?? [];
const substantive = (c: Criterion) => c.id !== "checks" && !/^Validate, SecurityScan/.test(c.detail);

/* Numeric margins read from a criterion's own detail text. One criterion can hold several (actual, bound) pairs, for example completed
   callers against a minimum and unsuccessful callers against a maximum. signed > 0 is on the passing side; pct is relative to the bound. */
interface Pair { label: string; actual: number; bound: number; dir: "min" | "max"; signed: number; pct: number | null }
function pairs(c: Criterion): Pair[] {
  const t = c.detail.replace(/(\d),(?=\d{3})/g, "$1"), out: Pair[] = [];
  const add = (label: string, actual: number, bound: number, dir: "min" | "max") => {
    const signed = dir === "min" ? actual - bound : bound - actual;
    out.push({ label, actual, bound, dir, signed, pct: bound === 0 ? null : (signed / Math.abs(bound)) * 100 });
  };
  let m = /p95 was ([\d.]+) ms.*?the limit is ([\d.]+) ms/.exec(t);
  if (m) { add("p95 ms", +m[1]!, +m[2]!, "max"); return out; }
  m = /At second \d+, [^,]*?(\d+) later replicas.*?need (\d+)/.exec(t);
  if (m) { add("later replicas ready", +m[1]!, +m[2]!, "min"); return out; }
  m = /Backend measurement ages: (.*?) \(maximum (\d+) us each\)/.exec(t);
  const ages = m ? [...m[1]!.matchAll(/(\d+) us/g)].map((x) => +x[1]!) : [];
  if (m && ages.length) add("backend age us (worst)", Math.max(...ages), +m[2]!, "max");
  for (const x of t.matchAll(/(\d+(?:\.\d+)?) of (\d+) hits[^(]*\(maximum (\d+)[^)]*?at least (\d+) hits/g)) { add("hits behind", +x[1]!, +x[3]!, "max"); add("hits", +x[2]!, +x[4]!, "min"); }
  if (out.length && /hits behind/.test(out[0]!.label)) return out;
  for (const x of t.matchAll(/(minimum|maximum) (\d+(?:\.\d+)?)(?![\d.]| us each)/g)) {
    const at = x.index!, before = t.slice(0, at), open = before.lastIndexOf("("), close = before.lastIndexOf(")");
    const head = open > close ? before.slice(0, open) : before;   // inside a parenthesis the measured value precedes it
    const num = [...head.matchAll(/(\d+(?:\.\d+)?)(?=[^\d.]*$)/g)].pop();
    const words = head.slice(0, num?.index ?? 0).split(/[;:,]\s*/).pop()!.trim();
    const label = (head.slice((num?.index ?? 0) + (num?.[1]?.length ?? 0)).trim().split(/\s+/).slice(0, 2).join(" ") || words).replace(/[(:,;]/g, "");
    if (num) add(label, +num[1]!, +x[2]!, x[1] === "minimum" ? "min" : "max");
  }
  return out;
}
const bindingPair = (c: Criterion) => { const p = pairs(c); return p.length ? p.reduce((a, b) => (a.signed / (Math.abs(a.bound) || 1) <= b.signed / (Math.abs(b.bound) || 1) ? a : b)) : null; };
const fmtPair = (p: Pair) => `${p.label} ${p.actual}${p.dir === "min" ? ">=" : "<="}${p.bound} (${p.signed >= 0 ? "+" : ""}${+p.signed.toFixed(3)}${p.pct === null ? "" : `, ${p.pct >= 0 ? "+" : ""}${p.pct.toFixed(1)}%`})`;
/* what to show: the pairs that decide the verdict (failing pairs if not met; otherwise the tightest passing pair) */
const fmtMargin = (c: Criterion) => {
  const p = pairs(c);
  if (!p.length) return `${c.detail.slice(0, 70)} (state, no numeric bound)`;
  const failing = p.filter((x) => x.signed < 0);
  const shown = c.status === "met" ? p : failing.length ? failing : [bindingPair(c)!];
  return shown.map(fmtPair).join(", ");
};

function verdict(d: ChallengeDefinition, design: ChallengeStarter) {
  const row = attemptRow(d, design, pick(d, design));
  return { row, report: buildRunReport(row) };
}
const source = (id: string) => {
  const dirs = ["learning/content"]; const out: string[] = [];
  for (const dir of dirs) for (const track of readdirSync(resolve(backend, dir), { withFileTypes: true })) {
    if (!track.isDirectory()) continue;
    try { for (const f of readdirSync(resolve(backend, dir, track.name, "lessons"))) if (f.replace(/\.ts$/, "").replace(/-v\d+$/, "") === id) out.push(f); } catch { /* no lessons dir */ }
  }
  return out;
};
void source;

// ---- test citations: files that already prove replay parity or evidence refusal for the lab (or import a fixture that names it)
const testsDir = resolve(backend, "tests");
const testFiles = readdirSync(testsDir).filter((f) => /\.(test|fixture)\.ts$/.test(f));
const text = new Map(testFiles.map((f) => [f, readFileSync(resolve(testsDir, f), "utf8")]));
function citations(id: string) {
  const direct = testFiles.filter((f) => text.get(f)!.includes(`"${id}"`) || text.get(f)!.includes(`'${id}'`));
  const viaFixture = testFiles.filter((f) => f.endsWith(".test.ts") && [...text.get(f)!.matchAll(/from "\.\/([A-Za-z0-9.]+\.fixture)"/g)].some((m) => direct.includes(`${m[1]}.ts`)));
  const files = [...new Set([...direct, ...viaFixture])].filter((f) => f.endsWith(".test.ts"));
  const parity = files.filter((f) => /parity|replay/i.test(f) || /browser-target bundle|server replay|round-trip|round trip/i.test(text.get(f)!));
  const refusal = files.filter((f) => /not-evaluated|undefined\)|refus|missing evidence|missing, malformed|malformed/i.test(text.get(f)!) && /evidence|criterion|criteria/i.test(text.get(f)!));
  return { parity, refusal };
}

// ---- one lab
async function closure(id: string) {
  const entry = latestChallenge(id)!, d = entry.definition, start = d.starter!;
  const lesson = labLessons.find((l) => l.experiment!.challengeId === id), pinKey = lesson ? `${lesson.id}@${lesson.contentVersion}` : null;
  const pin = pinKey ? REVIEWED_CHALLENGES[pinKey] : undefined;
  const ref = REFERENCE[id], near = NEAR_MISS[id];
  const out: Record<string, unknown> = { id, version: d.version, lesson: pinKey, why: [...(why.get(id) ?? [])].join("; "), hashOk: !!pin && pin.hash === specHash(d) && pin.version === d.version,
    expectedChanges: [] as string[] };
  const nearDesign = near ? (() => { const s = structuredClone(start); near.edit(s); return s; })() : null;
  const designs = { starter: start, reference: ref ?? null, nearMiss: nearDesign };
  const runs: Record<string, { row: ReturnType<typeof attemptRow>; report: Report } | null> = {};
  const errors: string[] = [];
  for (const [name, design] of Object.entries(designs)) {
    if (!design) { runs[name] = null; continue; }
    const pre = preflight(d, design);
    if (pre.errors.length) errors.push(`${name} preflight: ${pre.errors.join(" | ")}`);
    runs[name] = verdict(d, design);
  }
  const status = (n: string) => (runs[n] ? runs[n]!.report.challenge!.status : "MISSING");
  const crit = (n: string) => (runs[n] ? criteriaOf(runs[n]!.report).filter(substantive) : []);
  const failing = (n: string) => crit(n).filter((c) => c.status !== "met");
  const start0 = runs.starter!;
  const changes = (n: string) => runs[n] ? reviewDesignChanges(captureRunInputs({ ...start, layoutVersion: 3 }, d.workload, challengeSeed(d)), captureRunInputs({ ...designs[n as "reference"]!, layoutVersion: 3 }, d.workload, challengeSeed(d))) : null;
  const refChange = changes("reference"), nearChange = changes("nearMiss");

  // is the near miss the lab's pinned wrong fix: named in the definition text, else only in the lesson, else not named
  const defText = [...d.story, ...d.hints, ...d.debrief].join(" "), lessonText = lesson ? [...lesson.explanation, ...lesson.limitations, lesson.followUp ?? "", lesson.experiment!.prediction ?? ""].join(" ") : "";
  const named = !near ? "n/a" : near.cue.test(defText) ? "definition" : near.cue.test(lessonText) ? "lesson only" : "NOT NAMED";

  // missing or corrupt evidence: the reference run's saved snapshot, damaged, must never yield met for a criterion that cites it
  const probes: Record<string, string> = {};
  const probeProblems: string[] = [];
  if (runs.reference) {
    const row = runs.reference.row;
    const damaged = (kind: "absent" | "metrics" | "traffic" | "freshness") => {
      const copy = { ...row, runInputs: JSON.parse(JSON.stringify(row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(row.terminalSnapshot)) } as typeof row;
      const snap = copy.terminalSnapshot as unknown as Record<string, unknown>;
      if (kind === "absent") (copy as { terminalSnapshot: unknown }).terminalSnapshot = null;
      else if (kind === "metrics") snap.metrics = {};
      else if (kind === "traffic") delete snap.traffic;
      else snap.measurementFreshness = "unknown";
      return buildRunReport(copy).challenge!.criteria;
    };
    for (const kind of ["absent", "metrics", "traffic", "freshness"] as const) {
      const cs = damaged(kind).filter(substantive);
      const touched = cs.filter((c) => kind === "absent" ? c.sources.some((s) => s.startsWith("terminalSnapshot")) : kind === "metrics" ? c.sources.some((s) => s.startsWith("terminalSnapshot.metrics")) : kind === "traffic" ? c.sources.some((s) => s.startsWith("terminalSnapshot.traffic")) : false);
      const met = touched.filter((c) => c.status === "met");
      probes[kind] = kind === "freshness" ? `${cs.filter((c) => c.status === "met").length}/${cs.length} still met` : `${touched.length} citing, ${touched.filter((c) => c.status === "not-evaluated").length} not-evaluated, ${touched.filter((c) => c.status === "not-met").length} not-met, ${met.length} MET`;
      if (met.length) probeProblems.push(`${kind}: ${met.map((c) => c.id).join(",")} stayed met on damaged evidence`);
    }
  }

  // replay determinism: a second fresh run of the reference gives the same criteria and terminal; a saved row (JSON round trip) rebuilds the same report
  let determinism = "n/a";
  if (runs.reference) {
    const again = verdict(d, designs.reference!), first = runs.reference.report;
    const sameRun = JSON.stringify([criteriaOf(first).map((c) => [c.id, c.status, c.detail]), first.terminal?.traffic?.wholeRun, first.terminal?.resources]) === JSON.stringify([criteriaOf(again.report).map((c) => [c.id, c.status, c.detail]), again.report.terminal?.traffic?.wholeRun, again.report.terminal?.resources]);
    const saved = { ...runs.reference.row, runInputs: JSON.parse(JSON.stringify(runs.reference.row.runInputs)), terminalSnapshot: JSON.parse(JSON.stringify(runs.reference.row.terminalSnapshot)) } as typeof runs.reference.row;
    const sameSaved = JSON.stringify(buildRunReport(saved).challenge!.criteria) === JSON.stringify(first.challenge!.criteria) && JSON.stringify(buildRunReport(saved).terminal) === JSON.stringify(first.terminal);
    determinism = `rerun ${sameRun ? "identical" : "DIFFERS"}, saved row ${sameSaved ? "identical" : "DIFFERS"}`;
    if (!sameRun || !sameSaved) errors.push(`determinism: ${determinism}`);
  }

  const cite = citations(id);
  const thin: string[] = [], ceiling: string[] = [], guards: string[] = [];
  const bindingOf = (n: string) => failing(n).map((c) => `${c.id}: ${fmtMargin(c)}`);
  // Thin reference margins. Bounds below 10 are discrete counts (one replica, two admissions): a structural condition, not a tunable margin.
  // A guard is a criterion the starter already meets; only a binding criterion (the starter fails it) can make a thin reference margin a problem.
  for (const c of crit("reference")) for (const p of pairs(c)) if (p.pct !== null && p.pct < 3 && Math.abs(p.bound) >= 10 && c.status === "met") {
    const binding = failing("starter").some((f) => f.id === c.id);
    (binding ? thin : guards).push(`reference ${c.id} ${p.label} passes by only ${p.pct.toFixed(1)}% (${p.actual} vs ${p.bound})${binding ? "" : " [guard: the starter already meets it]"}`);
  }
  for (const c of crit("reference")) { const o = /(\d+) originals, .*?(\d+) acknowledged \(minimum (\d+)/.exec(c.detail); if (o && o[1] === o[2]) ceiling.push(`${c.id}: reference acknowledges all ${o[1]} originals, so its margin over the ${o[3]} minimum cannot grow`); }
  for (const n of ["starter", "nearMiss"]) for (const c of failing(n)) for (const p of pairs(c)) if (p.pct !== null && p.pct < 0 && p.pct > -3) thin.push(`${n} ${c.id} ${p.label} fails by only ${Math.abs(p.pct).toFixed(1)}% (${p.actual} vs ${p.bound})`);
  void start0;
  Object.assign(out, {
    status: { starter: status("starter"), reference: status("reference"), nearMiss: status("nearMiss") },
    starterFails: failing("starter").map((c) => c.id), starterMargins: bindingOf("starter"),
    referenceMargins: crit("reference").map((c) => `${c.id}: ${fmtMargin(c)}`), nearMargins: bindingOf("nearMiss"),
    nearWhat: near?.what ?? "MISSING NEAR-MISS ENTRY", nearNamed: named,
    refOneChange: refChange ? `${refChange.classification}${refChange.count === null ? "" : ` (${refChange.count})`}` : "MISSING", nearOneChange: nearChange ? `${nearChange.classification}${nearChange.count === null ? "" : ` (${nearChange.count})`}` : "MISSING",
    probes, probeProblems, determinism, cite, thin, guards, ceiling, errors, pinKey, pinOk: !!pin,
    details: Object.fromEntries(["starter", "reference", "nearMiss"].map((n) => [n, crit(n).map((c) => ({ id: c.id, status: c.status, detail: c.detail }))])),
  });
  return out;
}

const results: Array<Record<string, unknown>> = [];
console.error(`base ${base}: ${labs.length} labs derived from the tree`);
for (const id of labs) {
  const t = Date.now();
  try { results.push(await closure(id)); } catch (e) { results.push({ id, errors: [`closure failed: ${(e as Error).message}`] }); }
  console.error(`  ${id} ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
if (args.includes("--json")) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }

const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "/");
console.log(`\nLAB COMPLETENESS MATRIX: ${results.length} labs (derived from git diff ${base}..working tree)\n`);
console.log("| Lab | Pin / hash | Starter (failing criterion and margin) | Reference (margin) | Near miss (what; failing criterion and margin) | Near miss named as wrong fix | One change ref / near | Missing evidence (absent snapshot / no metrics / no traffic) | Determinism |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  const s = r.status as Record<string, string> | undefined;
  if (!s) { console.log(`| ${r.id} | | ERROR ${cell((r.errors as string[])[0])} | | | | | | |`); continue; }
  const p = r.probes as Record<string, string>;
  console.log(`| ${r.id}@${r.version} | ${r.pinKey} ${r.pinOk && r.hashOk ? "hash ok" : "HASH MISMATCH"} | ${s.starter}: ${cell((r.starterMargins as string[]).join("; "))} | ${s.reference}: ${cell((r.referenceMargins as string[]).join("; "))} | ${r.nearWhat}: ${s.nearMiss}: ${cell((r.nearMargins as string[]).join("; "))} | ${r.nearNamed} | ${r.refOneChange} / ${r.nearOneChange} | ${cell(p.absent)} / ${cell(p.metrics)} / ${cell(p.traffic)} | ${r.determinism} |`);
}
console.log("\nCITED EXISTING TESTS (replay parity and evidence refusal)");
for (const r of results) { const c = r.cite as { parity: string[]; refusal: string[] } | undefined; if (c) console.log(`- ${r.id}: parity/replay [${c.parity.join(", ") || "none found"}]; evidence refusal [${c.refusal.join(", ") || "none found"}]`); }
console.log("\nFLAGS (real problems only)");
let flags = 0;
const guardNotes: string[] = [];
for (const r of results) {
  const s = r.status as Record<string, string> | undefined;
  for (const g of (r.guards as string[] | undefined) ?? []) guardNotes.push(`${r.id}: ${g}`);
  const problems = [...((r.errors as string[]) ?? []), ...((r.probeProblems as string[]) ?? []), ...((r.thin as string[]) ?? []), ...((r.ceiling as string[]) ?? []).map((x) => `ceiling-capped: ${x}`)];
  if (s) {
    if (s.starter !== "not-met") problems.push(`starter is ${s.starter}`);
    if (s.reference !== "met") problems.push(`reference is ${s.reference}`);
    if (s.nearMiss !== "not-met") problems.push(`near miss is ${s.nearMiss}`);
    if (!(r.pinOk && r.hashOk)) problems.push("pin or hash mismatch");
    if (r.nearNamed === "NOT NAMED") problems.push(`near miss "${r.nearWhat}" is not named in the definition or lesson text`);
    if (r.refOneChange !== "one-change (1)" || r.nearOneChange !== "one-change (1)") problems.push(`not a one-change design: reference ${r.refOneChange}, near ${r.nearOneChange}`);
    if (!(r.cite as { parity: string[] }).parity.length) problems.push("no existing parity/replay test cites this lab");
  }
  for (const p of problems) { flags++; console.log(`- ${r.id}: ${p}`); }
}
console.log(flags === 0 ? "none" : `${flags} flag(s)`);
console.log("\nNOTES (not problems): thin margins on guard criteria that the starter already meets");
for (const g of guardNotes) console.log(`- ${g}`);
void basename;
