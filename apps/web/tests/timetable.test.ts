import { expect, test } from "bun:test";
import type { ExperimentTrace } from "@infraforge/contracts/reports";
import { fromExperimentTrace } from "../src/features/timetable/fromTrace";
import { fromLiveSnapshots } from "../src/features/timetable/fromSnapshots";
import { fromCausalJournal, pathEdges, type CausalEvent } from "../src/features/timetable/fromCausal";
import { sampleAt } from "../src/features/timetable/model";
import { statesAt } from "../src/features/timetable/stationStates";
import { momentsOf, snapTime } from "../src/features/timetable/moments";
import { layoutTiers } from "../src/features/timetable/tiers";
import { landingModel } from "../src/features/landing/sample";
import { experimentResult } from "./fixtures";

const point = (t: number) => ({ version: 1, simulatedSeconds: t, sampledAt: "2026-10-14T00:00:00.000Z", topologyRevision: 0,
  overallHealth: t <= 60 ? "healthy" : "critical", loadFraction: 1, targetLoadFraction: 1,
  resources: [{ id: "app-2", health: t <= 60 ? "healthy" : "failed", cpu: t <= 60 ? 45 : 0, memory: 48 }], pools: [] });
const trace = (missing: number[] = []): ExperimentTrace => ({
  status: missing.length ? "incomplete" : "complete", reason: "", expectedStart: 30, expectedEnd: 90, actualFirst: 30, actualLast: 90,
  sampleCount: 61 - missing.length, missingRanges: missing.length ? [{ start: missing[0]!, end: missing.at(-1)! }] : [],
  moments: null, resourceFacts: [], resourceFactsOmitted: 0,
  points: Array.from({ length: 61 }, (_, i) => point(i + 30)).filter((p) => !missing.includes(p.simulatedSeconds)) as ExperimentTrace["points"],
});
const stations = [{ id: "app-2", label: "app-2", type: "Virtual Machine" }];

test("a recorded trace has rails and state, never trains, and unretained time is an Unknown window", () => {
  const model = fromExperimentTrace({ trace: trace(), experiment: experimentResult, stations })!;
  expect(model.trains).toEqual([]);
  expect(model.windows.find((w) => w.kind === "unknown")).toMatchObject({ from: 0, to: 30 });
  expect(model.lanes["app-2"]!.samples).toHaveLength(61);
});

test("missing seconds stay Unknown: no sample is carried across a gap and the map shows no health", () => {
  const model = fromExperimentTrace({ trace: trace([73, 74]), experiment: experimentResult, stations })!;
  expect(model.windows.some((w) => w.kind === "unknown" && w.from === 73 && w.to === 75)).toBe(true);
  expect(sampleAt(model.lanes["app-2"]!.samples, 73, 1)).toBeNull();
  expect(statesAt(model, 73)["app-2"]).toEqual({ health: null, reading: "Not retained" });
  expect(statesAt(model, 10)["app-2"]!.health).toBeNull();
  expect(statesAt(model, 72)["app-2"]!.reading).toBe("CPU 0%");
});

test("seconds snap to whole seconds; causal time snaps to recorded events only", () => {
  const model = fromExperimentTrace({ trace: trace(), experiment: experimentResult, stations })!;
  expect(snapTime(model, 61.6)).toBe(62);
  expect(snapTime(model, 500)).toBe(90);
  const causal = fromCausalJournal(journal, 60_000);
  expect(snapTime(causal, 16_400)).toBe(17_000);
  expect(momentsOf(causal)).toContain(2_000);
});

test("the live timetable draws only the seconds this page received, and a fault is due until its second", () => {
  const received = [5, 6, 9].map((t) => ({ t, system: "healthy" as const, resources: { "app-2": { health: "healthy" as const, cpu: 40 } } }));
  const plan = { fault: "crash", at: 60, duration: 30, target: "app-2" };
  const model = fromLiveSnapshots({ stations, received, now: 9, plan, evaluation: 90 });
  expect(model.lanes["app-2"]!.samples.map((s) => s.t)).toEqual([5, 6, 9]);
  expect(sampleAt(model.lanes["app-2"]!.samples, 7, 1)).toBeNull();
  expect(model.marks[0]!.label).toBe("Crash due 60s");
  expect(fromLiveSnapshots({ stations, received, now: 61, plan, evaluation: 90 }).marks[0]!.label).toBe("Crash 60s");
  expect(model.trains).toEqual([]);
});

const work = (root: string, operation: string) => ({ rootId: root, callId: root, attempt: 0, operation, offeredAt: 0 });
const R1 = '["root","product-workload","arrival-0"]', R2 = '["root","product-workload","arrival-1"]', H = '["health","lb","app-a",0]';
const journal = { complete: true, omitted: 0, events: [
  { atUs: 0, kind: "app-admitted", resource: "app-a", work: work(H, "health") },
  { atUs: 2_000, kind: "caller-offered", resource: "$caller", work: work(R1, "write") },
  { atUs: 2_000, kind: "lb-received", resource: "lb", work: work(R1, "write") },
  { atUs: 2_002, kind: "app-admitted", resource: "app-a", work: work(R1, "write") },
  { atUs: 2_010, kind: "db-terminal", resource: "db", work: work(R1, "write"), detail: { outcome: "committed", writes: 1 } },
  { atUs: 2_012, kind: "app-terminal", resource: "app-a", work: work(R1, "write") },
  { atUs: 2_017, kind: "caller-terminal", resource: "$caller", work: work(R1, "write"), detail: { outcome: "completed" } },
  { atUs: 17_000, kind: "network-intervention", resource: "network", detail: { id: "app-crash:app-a", detail: "applied" } },
  { atUs: 17_000, kind: "process-crash", resource: "app-a" },
  { atUs: 30_000, kind: "health-observation", resource: "network", detail: { id: '["health","lb","app-a",2]', detail: "backend-rejected:eligible=false" } },
  { atUs: 34_000, kind: "network-intervention", resource: "network", detail: { id: "app-crash:app-a", detail: "ended" } },
  { atUs: 39_000, kind: "process-ready", resource: "app-a" },
  { atUs: 45_017, kind: "health-observation", resource: "network", detail: { id: '["health","lb","app-a",3]', detail: "passed:eligible=true" } },
  { atUs: 57_000, kind: "caller-offered", resource: "$caller", work: work(R2, "read") },
  { atUs: 57_000, kind: "lb-received", resource: "lb", work: work(R2, "read") },
] as CausalEvent[] };

test("a causal journal becomes trains for product requests only, with recorded process and balancer intervals", () => {
  const model = fromCausalJournal(journal, 60_000);
  expect(model.stations.map((s) => s.id)).toEqual(["$caller", "lb", "app-a", "db"]);
  expect(model.trains.map((t) => t.id)).toEqual([R1, R2]);
  expect(model.trains[0]).toMatchObject({ outcome: "completed", commitAt: 2_010, endAt: 2_017 });
  // No caller outcome by the horizon is Unknown, not a failure.
  expect(model.trains[1]).toMatchObject({ outcome: "in-flight", endAt: null });
  expect(model.lanes["app-a"]!.bands).toEqual([
    { from: 17_000, to: 34_000, kind: "down", label: "process down" },
    { from: 34_000, to: 39_000, kind: "unready", label: "not ready" },
    { from: 30_000, to: 45_017, kind: "ineligible", label: "not eligible at the load balancer" },
  ]);
  expect(model.windows).toEqual([{ from: 17_000, to: 34_000, kind: "fault", label: "app crash on app-a" }]);
  expect(statesAt(model, 36_000)["app-a"]!.flags).toEqual(["not ready", "not eligible at the load balancer"]);
  expect(statesAt(model, 50_000)["app-a"]!.health).toBeUndefined();
  // Return hops share the outbound rails.
  expect(pathEdges(model)).toEqual([{ source: "$caller", target: "lb" }, { source: "lb", target: "app-a" }, { source: "app-a", target: "db" }]);
});

test("tiers read left to right by longest path and keep every station through a cycle", () => {
  const { placed, cols } = layoutTiers(
    ["dns", "lb", "a", "b", "db"].map((id) => ({ id, type: null, label: id })),
    [["dns", "lb"], ["lb", "a"], ["lb", "b"], ["a", "db"], ["b", "db"], ["db", "lb"]].map(([source, target]) => ({ source: source!, target: target! })));
  const col = Object.fromEntries(placed.map((p) => [p.id, p.col]));
  expect(placed).toHaveLength(5); expect(cols).toBe(4);
  expect(col).toMatchObject({ dns: 0, lb: 1, a: 2, b: 2, db: 3 });
});

test("the landing sample is a complete recorded run with nothing to hatch", () => {
  const model = landingModel();
  expect(model.windows.filter((w) => w.kind === "unknown")).toEqual([]);
  expect(model.trains).toEqual([]);
  expect(Object.values(model.lanes).every((l) => l.samples.length === 60)).toBe(true);
});
