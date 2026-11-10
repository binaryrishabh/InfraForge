import type { ChallengeCriterion } from "@infraforge/contracts/challenges";
import type { ReportCheckpoint } from "@infraforge/contracts/reports";
import type { Topology } from "./criteria";
import { StartupSchema } from "../reports/startupSchema";

type Criterion = Extract<ChallengeCriterion, {kind: "startup-capacity"}>;
const sources = ["runInputs.resources.autoscaling", "terminalSnapshot.simulatedSeconds", "terminalSnapshot.metrics.startup.controllers"];
const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/** Counts later replicas with a measured listener and current LB eligibility at one instant. */
export function evaluateStartupCapacity(c: Criterion, input: Topology | null, terminal: ReportCheckpoint | null, second: number) {
  const unknown = (detail: string) => ({met: undefined, detail, sources});
  if (!input || !terminal || terminal.simulatedSeconds !== second || terminal.measurementFreshness !== "current-revision") return unknown("Current startup evidence at the exact evaluation second is required.");
  const captured = input.resources.filter(r => r.id === c.resourceId && r.type === "Virtual Machine"), policy = captured[0]?.autoscaling;
  if (captured.length !== 1 || !policy?.enabled || !count(policy.minReplicas) || policy.minReplicas < 1 || !count(policy.maxReplicas) ||
    policy.maxReplicas < policy.minReplicas || policy.maxReplicas > 100 || !count(c.minNewReady) || c.minNewReady < 1 || c.minNewReady > 100) return unknown("A named enabled VM pool with explicit bounded replica counts is required.");
  const rows = terminal.resources.filter(r => r.id === c.resourceId), parsed = StartupSchema.safeParse(rows[0]?.startup);
  if (rows.length !== 1 || !parsed.success) return unknown("Valid startup observations for the named pool were not recorded.");
  const m = parsed.data, controllers = m.controllers?.filter(p => p.id === c.resourceId), p = controllers?.[0];
  if (m.sampledAtUs !== second * 1_000_000 || m.omittedControllers !== 0 || controllers?.length !== 1 || !p ||
    !p.replicas || p.replicas.length !== policy.maxReplicas || p.omittedReplicas !== 0 || !p.events || p.omittedEvents !== 0 ||
    !count(p.inService) || !count(p.desired) || p.desired < policy.minReplicas || p.desired > policy.maxReplicas) return unknown("Complete controller identities, events, current counts and the exact startup sample time are required.");
  const initial = p.events.filter(e => e.kind === "initial-ready");
  if (initial.length !== policy.minReplicas || new Set(initial.map(e => e.id)).size !== initial.length ||
    initial.some(e => e.at !== 0 || !Array.from({length: policy.minReplicas!}, (_, i) => `${c.resourceId}#${i}`).includes(e.id))) return unknown("The initial deployed replica identities must be recorded without omissions.");
  let newReady = 0, inService = 0;
  const seen = new Set<number>();
  for (const r of p.replicas) {
    if (!count(r.ordinal) || r.ordinal >= policy.maxReplicas || seen.has(r.ordinal) || r.id !== `${c.resourceId}#${r.ordinal}` || !r.state ||
      r.createdAtUs === undefined || r.listenerReadyAtUs === undefined ||
      [r.endpointAlive, r.endpointReady, r.lbHealthy, r.lbDraining].some(v => typeof v !== "boolean")) return unknown("Replica identities, lifecycle times and endpoint/LB flags must be known and consistent.");
    seen.add(r.ordinal);
    const wasInitial = r.ordinal < policy.minReplicas;
    if (r.createdAtUs == null ? r.state !== "reserved" : r.state === "reserved" || !wasInitial && r.createdAtUs === 0) return unknown("Replica creation time does not match its lifecycle.");
    if (wasInitial && r.createdAtUs !== 0 || wasInitial && r.listenerReadyAtUs !== 0) return unknown("Initially deployed replica times are inconsistent.");
    if (r.state === "ready" && (r.listenerReadyAtUs == null || r.createdAtUs == null) ||
      r.listenerReadyAtUs != null && (r.createdAtUs == null || !wasInitial && r.listenerReadyAtUs <= r.createdAtUs)) return unknown("A ready listener needs its measured creation and startup times.");
    if (!wasInitial && r.createdAtUs != null && !p.events.some(e => e.kind === "replica-created" && e.id === r.id && e.at === r.createdAtUs) ||
      !wasInitial && r.listenerReadyAtUs != null && !p.events.some(e => e.kind === "readiness" && e.id === r.id && e.at === r.listenerReadyAtUs)) return unknown("Recorded lifecycle events must support the later replica's measured times.");
    const eligible = r.state === "ready" && r.endpointAlive && r.endpointReady && r.lbHealthy && !r.lbDraining;
    if (eligible) {inService++; if (!wasInitial) newReady++;}
  }
  if (inService !== p.inService) return unknown("Current LB eligibility does not reconcile with the retained replica identities.");
  return {met: newReady >= c.minNewReady, detail: `At second ${second}, ${newReady} later replicas have measured listener readiness and are currently alive, ready, LB healthy and not draining; need ${c.minNewReady}. ${p.inService} total LB-eligible replicas; desired ${p.desired}. Initially deployed replicas are excluded. This sample does not establish continuous health or first traffic.`, sources};
}
