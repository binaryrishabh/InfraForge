import { expect, test } from "bun:test";
import { staleLabFixture } from "./staleLab.fixture";
import { buildRunReport } from "../reports/report";
import { staleReadsLimits } from "../challenges/staleReadsCriterion";

test("stale-reads criterion refuses missing, stale, malformed or unbounded evidence as not-evaluated", () => {
  const {rows} = staleLabFixture(), good = rows[1]!;
  const run = (mutate: (r: typeof good) => void) => {
    const r = structuredClone(good) as typeof good; mutate(r);
    return buildRunReport(r).challenge!.criteria.find(c => c.id === "fresh")!.status;
  };
  expect(run(() => {})).toBe("met");
  const raw = (r: typeof good) => r.terminalSnapshot as unknown as {simulatedSeconds: number; metrics: Record<string, {readRouting?: unknown; database?: {readRouting?: unknown}}>};
  expect(run(r => {r.runInputs = null;})).toBe("not-evaluated");
  expect(run(r => {r.terminalSnapshot = null;})).toBe("not-evaluated");
  expect(run(r => {r.runtimeActive = true;})).toBe("not-evaluated");
  expect(run(r => {raw(r).simulatedSeconds--;})).toBe("not-evaluated");
  expect(run(r => {delete (raw(r).metrics.db as {database?: unknown}).database;})).toBe("not-evaluated");
  expect(run(r => {(raw(r).metrics.db!.database as {readRouting?: unknown}).readRouting = undefined;})).toBe("not-evaluated");
  expect(run(r => {((raw(r).metrics.db!.database as {readRouting: {staleReads: unknown}}).readRouting).staleReads = -1;})).toBe("not-evaluated");
  expect(staleReadsLimits({id: "x", kind: "stale-reads", label: "x", resourceId: "db", maxStaleReads: 1.5})).toBe(false);
  expect(staleReadsLimits({id: "x", kind: "stale-reads", label: "x", resourceId: "db", maxStaleReads: 1_000_001})).toBe(false);
  expect(staleReadsLimits({id: "x", kind: "stale-reads", label: "x", resourceId: "db", maxStaleReads: 0})).toBe(true);
});
