/** Timing ownership audit (traffic-evidence/2 only).
 * caller-offered -> completed caller-terminal owns responseUs, the sole denominator.
 * path-offered -> connection-acquired owns connection acquisition; acquired ->
 * request-delivered owns request transit. A remote-terminal observation is needed
 * for response transit; cumulative path remoteServiceUs includes nested work and
 * is never added. lb-received -> first selection owns LB pending wait.
 * app-admitted -> app-start owns application queue wait; start -> terminal owns
 * application residence, excluding its dependency intervals. app-dependency owns
 * downstream wait until its return; flow step boundaries prove flow dependency wait.
 * client-attempt terminal/issued prove failed attempt time and actual retry delay;
 * LB attempt-terminal proves failed LB attempts (never count overlapping work twice).
 * Database counters do not prove exclusive per-request database internals.
 * Missing boundaries remain unattributed. Health probes have no live caller root.
 * Each measured second uses completed callers only: all-request means divide by
 * completed count; tail means use the same nearest-rank p99 sample, >= threshold,
 * and are Unknown below 100 completions. Failures/stops/in-flight are counts only.
 */
export const TRAFFIC_EVIDENCE_PROFILE = "traffic-evidence/2" as const;

import type { CausalEvent, CausalObserver } from "./causal";

export type LatencyCategory = "connectionWait" | "networkTransit" | "loadBalancerPending" | "applicationQueue" | "applicationService" | "dependency" | "clientRetryDelay" | "failedAttempt";
type OwnedCategory = LatencyCategory | "failedClientAttempt";
export interface LatencySample {
  rootId: string; atUs: number; responseUs: number;
  categoriesUs: Partial<Record<LatencyCategory, number>>; unattributedUs: number; bounded: boolean;
}
interface Interval { category: OwnedCategory; start: number; end: number; scope: string }
interface Root { start: number; open: Map<string, Omit<Interval, "end">>; intervals: Interval[]; paths: Map<string, number | null>; bounded: boolean; transitions: number }
export const LATENCY_ROOT_BOUNDARIES = 128;
const priority: OwnedCategory[] = ["failedClientAttempt", "clientRetryDelay", "dependency", "failedAttempt", "applicationQueue", "applicationService", "loadBalancerPending", "connectionWait", "networkTransit"];

/** Pure observer: no kernel events, RNG, timers, historical trace reads or path totals. */
export function latencyComposition(maxLiveRoots: number, completed: (sample: LatencySample) => void, maxBoundaries = LATENCY_ROOT_BOUNDARIES) {
  const roots = new Map<string, Root>();
  const observe: CausalObserver = e => {
    const rootId = e.work?.rootId;
    if (!rootId) return;
    if (e.kind === "caller-offered") {
      if (roots.size >= maxLiveRoots) throw Error("Latency live-root budget exceeded");
      roots.set(rootId, { start: e.atUs, open: new Map(), intervals: [], paths: new Map(), bounded: true, transitions: 0 }); return;
    }
    const root = roots.get(rootId); if (!root) return; // late remote work and health probes never allocate roots
    const id = `${e.resource}:${e.work!.callId}`;
    const open = (key: string, category: OwnedCategory, scope = e.work!.callId) => {
      if (!root.bounded) return;
      if (++root.transitions > maxBoundaries || root.open.has(key)) { root.bounded = false; root.open.clear(); root.intervals = []; root.paths.clear(); return; }
      root.open.set(key, { category, start: e.atUs, scope });
    };
    const close = (key: string, keep = true) => {
      const item = root.open.get(key); if (!item) return;
      root.open.delete(key);
      if (keep) root.intervals.push({ ...item, end: e.atUs });
    };
    if (e.kind === "caller-terminal") {
      roots.delete(rootId);
      if (e.detail.outcome === "completed") completed(partition(rootId, root, e));
      return;
    }
    if (!root.bounded) return;
    if (e.kind === "app-admitted") open(`queue:${id}`, "applicationQueue");
    if (e.kind === "app-start") {
      if (root.open.has(`queue:${id}`)) { close(`queue:${id}`); open(`service:${id}`, "applicationService"); }
    }
    if (e.kind === "app-dependency") open(`dependency:${e.resource}:${e.work!.parentCallId}`, "dependency", e.work!.parentCallId);
    if (e.kind === "app-terminal") { close(`queue:${id}`); close(`service:${id}`); close(`dependency:${id}`); }
    if (e.kind === "flow-step-start" && e.detail.kind !== "compute") open(`flow:${id}:${e.detail.step}`, "dependency");
    if (e.kind === "flow-step-terminal") close(`flow:${id}:${e.detail.step}`);
    if (e.kind === "latency-path-start") { open(`connection:${id}`, "connectionWait"); if (root.bounded) root.paths.set(e.work!.callId, null); }
    if (e.kind === "latency-path-acquired") { close(`connection:${id}`); open(`network:${id}`, "networkTransit"); }
    if (e.kind === "latency-path-delivered") close(`network:${id}`);
    if (e.kind === "latency-path-remote-terminal") open(`network:${id}`, "networkTransit");
    if (e.kind === "latency-path-terminal") { close(`connection:${id}`); close(`network:${id}`); if (root.paths.has(e.work!.callId)) root.paths.set(e.work!.callId, e.atUs); }
    if (e.kind === "latency-lb-admitted") open(`lb:${id}`, "loadBalancerPending");
    if (e.kind === "latency-lb-start" || e.kind === "latency-lb-terminal") close(`lb:${id}`);
    if (e.kind === "latency-lb-attempt-start") open(`lb-attempt:${id}`, "failedAttempt");
    if (e.kind === "latency-lb-attempt-terminal") close(`lb-attempt:${id}`, e.detail.outcome !== "completed");
    if (e.kind === "client-attempt-issued") { close("retry"); open("client-attempt", "failedClientAttempt", "$caller"); }
    if (e.kind === "client-attempt-terminal") close("client-attempt", e.detail.outcome !== "completed");
    if (e.kind === "client-retry-scheduled") open("retry", "clientRetryDelay", "$caller");
  };
  return { observe, get liveRoots() { return roots.size; } };
}

function partition(rootId: string, root: Root, terminal: CausalEvent): LatencySample {
  const responseUs = terminal.detail.responseUs as number, categoriesUs: LatencySample["categoriesUs"] = {};
  // Unclosed boundaries cannot prove ownership. They stay in the remainder.
  const paths = [...root.paths].filter((p): p is [string, number] => p[1] !== null).map(([id, end]) => ({ parts: callParts(id), end }));
  const intervals = root.bounded ? root.intervals.map(i => {
    const scope = callParts(i.scope);
    const stops = paths.filter(p => p.parts.length <= scope.length && p.parts.every((v, n) => v === scope[n])).map(p => p.end);
    return { ...i, start: Math.max(root.start, i.start), end: Math.min(terminal.atUs, i.end, ...stops) };
  }).filter(i => i.end >= i.start) : [];
  const points = [...new Set([root.start, terminal.atUs, ...intervals.flatMap(i => [i.start, i.end])])].sort((a, b) => a - b);
  for (const i of intervals) categoriesUs[i.category === "failedClientAttempt" ? "failedAttempt" : i.category] ??= 0;
  for (let p = 1; p < points.length; p++) {
    const start = points[p - 1]!, end = points[p]!;
    const category = priority.find(c => intervals.some(i => i.category === c && i.start <= start && i.end >= end));
    if (category) { const key = category === "failedClientAttempt" ? "failedAttempt" : category; categoriesUs[key] = (categoriesUs[key] ?? 0) + end - start; }
  }
  const attributed = Object.values(categoriesUs).reduce((a, b) => a + b, 0);
  return { rootId, atUs: terminal.atUs, responseUs, categoriesUs, unattributedUs: responseUs - attributed, bounded: root.bounded };
}

function callParts(id: string): unknown[] {
  try { const parts: unknown = JSON.parse(id); return Array.isArray(parts) ? parts : [id]; } catch { return [id]; }
}
