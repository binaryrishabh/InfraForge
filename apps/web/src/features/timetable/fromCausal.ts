import type { Band, Lane, Station, Stop, TimetableModel, Train, Window } from "./model";

// The recorded causal journal of a connected Model 2 run, as the internal report carries it.
export interface CausalEvent {
  atUs: number;
  kind: string;
  resource: string;
  work?: { rootId: string; callId: string; parentCallId?: string; attempt: number; operation: string; offeredAt: number };
  detail?: Record<string, unknown>;
}
export interface CausalJournal { complete: boolean; omitted: number; events: CausalEvent[] }

const CALLER = "$caller";
// Where a station sits on the path, from the kind of event recorded at it.
const TIER: Record<string, number> = { caller: 0, lb: 1, app: 2, db: 3 };
const tierOf = (kind: string) => TIER[kind.split("-")[0]!] ?? 2;
const isHealthCheck = (root: string) => root.startsWith('["health"');
const backendOf = (id: unknown) => { try { const parts = JSON.parse(String(id)); return typeof parts[2] === "string" ? parts[2] as string : null; } catch { return null; } };

export function journalOf(report: unknown): CausalJournal | null {
  const c = (report as { causality?: CausalJournal } | null)?.causality;
  return c && Array.isArray(c.events) ? c : null;
}

/* A connected run's timetable. Every product request is a train: its stops are the journal
events recorded with its identity at a station, in order. Health checks are not trains;
what the load balancer concluded from them is drawn as a band instead. A request with no
recorded caller outcome by the horizon is "in-flight": its outcome is Unknown, not failed. */
export function fromCausalJournal(journal: CausalJournal, horizonUs: number): TimetableModel {
  const tier = new Map<string, number>();
  const trains = new Map<string, Train>();
  for (const e of journal.events) {
    if (!e.work || e.resource === "network") continue;
    tier.set(e.resource, Math.min(tier.get(e.resource) ?? 9, e.resource === CALLER ? 0 : tierOf(e.kind)));
    if (isHealthCheck(e.work.rootId)) continue;
    const train = trains.get(e.work.rootId) ?? { id: e.work.rootId, op: e.work.operation, stops: [] as Stop[], outcome: "in-flight", commitAt: null, endAt: null };
    train.stops.push({ t: e.atUs, station: e.resource, kind: e.kind });
    if (e.kind === "caller-terminal") { train.outcome = String(e.detail?.outcome ?? "Unknown"); train.endAt = e.atUs; }
    if (e.kind === "db-terminal" && e.detail?.outcome === "committed" && Number(e.detail?.writes ?? 0) > 0) train.commitAt = e.atUs;
    trains.set(e.work.rootId, train);
  }
  for (const e of journal.events) if (e.kind === "process-crash" || e.kind === "process-ready") tier.set(e.resource, tier.get(e.resource) ?? 2);

  const stations: Station[] = [...tier.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([id]) => ({ id, label: id === CALLER ? "Caller" : id, type: id === CALLER ? null : (tier.get(id) === 1 ? "Load Balancer" : tier.get(id) === 3 ? "Database" : "Virtual Machine") }));
  const lanes: Record<string, Lane> = Object.fromEntries(stations.map((s) => [s.id, { station: s.id, samples: [], bands: [] as Band[] }]));

  // Process and load-balancer state, each from its own recorded events.
  const windows: Window[] = [], crashedAt = new Map<string, number>(), restartedAt = new Map<string, number>();
  const ineligibleSince = new Map<string, number>(), applied = new Map<string, number>();
  for (const e of journal.events) {
    const d = e.detail ?? {};
    if (e.kind === "process-crash") crashedAt.set(e.resource, e.atUs);
    if (e.kind === "network-intervention") {
      const id = String(d.id ?? ""), target = id.split(":")[1] ?? "";
      if (d.detail === "applied") applied.set(id, e.atUs);
      if (d.detail === "ended") {
        const from = applied.get(id) ?? 0;
        windows.push({ from, to: e.atUs, kind: "fault", label: `${id.split(":")[0]!.replace(/-/g, " ")} on ${target}` });
        applied.delete(id);
        const down = crashedAt.get(target);
        if (down !== undefined) { lanes[target]?.bands.push({ from: down, to: e.atUs, kind: "down", label: "process down" }); crashedAt.delete(target); restartedAt.set(target, e.atUs); }
      }
    }
    if (e.kind === "process-ready") {
      const from = restartedAt.get(e.resource);
      if (from !== undefined) { lanes[e.resource]?.bands.push({ from, to: e.atUs, kind: "unready", label: "not ready" }); restartedAt.delete(e.resource); }
    }
    if (e.kind === "health-observation") {
      const backend = backendOf(d.id), eligible = String(d.detail ?? "").endsWith("eligible=true");
      if (!backend || !lanes[backend]) continue;
      if (!eligible && !ineligibleSince.has(backend)) ineligibleSince.set(backend, e.atUs);
      if (eligible && ineligibleSince.has(backend)) { lanes[backend]!.bands.push({ from: ineligibleSince.get(backend)!, to: e.atUs, kind: "ineligible", label: "not eligible at the load balancer" }); ineligibleSince.delete(backend); }
    }
  }
  // Intervals still open at the horizon end there; what happens after it was not recorded.
  for (const [id, from] of applied) windows.push({ from, to: horizonUs, kind: "fault", label: `${id.split(":")[0]!.replace(/-/g, " ")} on ${id.split(":")[1] ?? ""}` });
  for (const [id, from] of crashedAt) lanes[id]?.bands.push({ from, to: horizonUs, kind: "down", label: "process down" });
  for (const [id, from] of restartedAt) lanes[id]?.bands.push({ from, to: horizonUs, kind: "unready", label: "not ready" });
  for (const [id, from] of ineligibleSince) lanes[id]?.bands.push({ from, to: horizonUs, kind: "ineligible", label: "not eligible at the load balancer" });

  const marks = [...journal.events.filter((e) => e.kind === "process-crash").map((e) => ({ t: e.atUs, kind: "fault" as const, label: `${e.resource} crashed`, station: e.resource }))];
  const list = [...trains.values()].sort((a, b) => a.stops[0]!.t - b.stops[0]!.t);
  const open = list.filter((t) => t.outcome === "in-flight").length;
  return {
    unit: "us", start: 0, end: horizonUs, stations, lanes, system: [], trains: list, windows, marks, predictions: [],
    evidence: {
      complete: journal.complete && journal.omitted === 0,
      note: `${journal.events.length} recorded events${journal.omitted ? `, ${journal.omitted} omitted` : ""}; ${list.length} requests${open ? `, ${open} with no outcome recorded by the horizon` : ""}.`,
    },
  };
}

const TYPE_TIER: Record<string, number> = { "Load Balancer": 1, "Virtual Machine": 2, Database: 3 };

// The station map's rails: each hop a request was recorded making towards the database. Return hops are the same rails.
export function pathEdges(model: TimetableModel) {
  const tierOfStation = new Map(model.stations.map((s) => [s.id, s.id === CALLER ? 0 : TYPE_TIER[s.type ?? ""] ?? 2]));
  const seen = new Set<string>(), edges: Array<{ source: string; target: string }> = [];
  for (const train of model.trains) for (let i = 1; i < train.stops.length; i++) {
    const a = train.stops[i - 1]!.station, b = train.stops[i]!.station;
    if ((tierOfStation.get(a) ?? 0) >= (tierOfStation.get(b) ?? 0) || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`); edges.push({ source: a, target: b });
  }
  return edges;
}
