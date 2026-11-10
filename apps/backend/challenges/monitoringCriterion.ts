import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import type { Topology } from "./criteria";
import { MonitoringBackendSchema, MonitoringMetricsSchema } from "../reports/monitoringSchema";

type Criterion = Extract<ChallengeCriterion, {kind: "monitoring-delivery"}>;
const safe = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const sameIds = (actual: string[], expected: string[]) => actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));

/** Fixed-horizon educational delivery counts and backend age, never collector health. */
export function evaluateMonitoringDelivery(c: Criterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number, active: boolean): {met?: boolean; detail: string; sources: string[]} {
  const sources = ["runInputs.resources", "runInputs.connectionLines", "terminalSnapshot.metrics.monitoring", "terminalSnapshot.metrics.monitoringBackend"];
  const unknown = (detail: string) => ({detail, sources});
  if (active || !input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") {
    return unknown("A completed run with a current terminal measurement at the exact evaluation second is required.");
  }
  const owners = input.resources.filter(r => r.id === c.resourceId);
  const targets = input.connectionLines.filter(l => l.sourceId === c.resourceId).map(l => l.targetId);
  if (owners.length !== 1 || owners[0]!.type !== RESOURCE_TYPES.MonitoringAgent || !sameIds(targets, c.targetIds) ||
    c.targetIds.some(id => input.resources.filter(r => r.id === id && (r.type === RESOURCE_TYPES.VirtualMachine || r.type === RESOURCE_TYPES.Database)).length !== 1)) {
    return unknown("The captured design must retain the named monitor and every expected target connection without replacement or duplication.");
  }
  const rows = terminal.resources.filter(r => r.id === c.resourceId);
  if (rows.length !== 1 || c.targetIds.some(id => {
    const measured = terminal.resources.filter(r => r.id === id);
    return measured.length !== 1;
  })) return unknown("Matching monitor and target measurements are required.");
  const collector = MonitoringMetricsSchema.safeParse(rows[0]!.monitoring), backend = MonitoringBackendSchema.safeParse(rows[0]!.monitoringBackend);
  if (!collector.success || !backend.success) return unknown("Complete valid collector and backend evidence is required.");
  const m = collector.data, b = backend.data;
  if (b.id !== c.backendId || ![m.generated, m.droppedBeforeExport, b.received, b.duplicates].every(safe) || !m.freshness || !b.latest ||
    !sameIds(m.freshness.map(r => r.target), c.targetIds) || !sameIds(b.latest.map(r => r.target), c.targetIds)) {
    return unknown("The named backend, safe generated/received/drop/duplicate counts and both expected target identities are required.");
  }
  if (m.droppedBeforeExport! > m.generated! || b.duplicates! > b.received! || b.received! - b.duplicates! > m.generated! - m.droppedBeforeExport!) {
    return unknown("Recorded sample populations are inconsistent: pre-export drops cannot arrive, and duplicate occurrences cannot exceed received samples.");
  }
  const nowUs = second * 1_000_000;
  if (!safe(nowUs) || b.latest.some(r => !safe(r.measurementAt) || !safe(r.arrivedAt) || !safe(r.ageUs) ||
    r.measurementAt > r.arrivedAt || r.arrivedAt > nowUs || r.ageUs !== nowUs - r.measurementAt)) {
    return unknown("Each backend target needs a valid measurement time, arrival time and age at the terminal boundary; missing ages stay Unknown.");
  }
  const ages = b.latest.map(r => `${r.target}: ${r.ageUs} us`).join(", ");
  return {met: m.generated! >= c.minGenerated && b.received! >= c.minReceived && b.duplicates === 0 && m.droppedBeforeExport === 0 && b.latest.every(r => r.ageUs! <= c.maxBackendAgeUs),
    detail: `Through second ${second}, ${c.resourceId}: ${m.generated} generated (minimum ${c.minGenerated}); ${b.received} backend received (minimum ${c.minReceived}); ${b.duplicates} duplicates and ${m.droppedBeforeExport} pre-export drops (both must be 0). Backend measurement ages: ${ages} (maximum ${c.maxBackendAgeUs} us each). This terminal sample proves no continuous freshness or durability guarantee.`, sources};
}
