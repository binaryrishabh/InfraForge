import type { EventClock } from "../time";

export type LifecycleState = "created" | "registered" | "ready" | "draining" | "retired";
export interface LifecycleIdentity { readonly id: string; readonly generation: number }
export class Lifecycle {
  private records = new Map<string, { identity: LifecycleIdentity; state: LifecycleState; cleanup: Set<() => void> }>();
  constructor(private readonly maxIdentities: number) {
    if (!Number.isSafeInteger(maxIdentities) || maxIdentities <= 0) throw Error("Invalid lifecycle budget");
  }
  create(id: string): LifecycleIdentity {
    const prior = this.records.get(id);
    if (!id || (prior && prior.state !== "retired") || (!prior && this.records.size >= this.maxIdentities)) throw Error("Duplicate/invalid lifecycle owner or identity budget exhausted");
    const generation = (prior?.identity.generation ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) throw Error("Lifecycle generation exhausted");
    const identity = Object.freeze({ id, generation });
    this.records.set(id, { identity, state: "created", cleanup: new Set() }); return identity;
  }
  private record(identity: LifecycleIdentity) {
    const record = this.records.get(identity.id);
    if (!record || record.identity !== identity) throw Error("Stale lifecycle generation");
    return record;
  }
  state(identity: LifecycleIdentity) { return this.record(identity).state; }
  private transition(identity: LifecycleIdentity, from: LifecycleState, to: LifecycleState) {
    const record = this.record(identity);
    if (record.state !== from) throw Error(`Invalid lifecycle transition: ${record.state} → ${to}`);
    record.state = to;
  }
  register(identity: LifecycleIdentity) { this.transition(identity, "created", "registered"); }
  ready(identity: LifecycleIdentity) { this.transition(identity, "registered", "ready"); }
  drain(identity: LifecycleIdentity) { this.transition(identity, "ready", "draining"); }
  own(identity: LifecycleIdentity, cleanup: () => void) {
    const record = this.record(identity);
    if (record.state === "retired") throw Error("Retired lifecycle owner");
    record.cleanup.add(cleanup); return () => record.cleanup.delete(cleanup);
  }
  retire(identity: LifecycleIdentity) {
    const record = this.record(identity);
    if (record.state === "retired") throw Error("Already retired lifecycle owner");
    record.state = "retired";
    let failure: unknown;
    for (const cleanup of record.cleanup) { try { cleanup(); } catch (error) { failure ??= error; } }
    record.cleanup.clear();
    if (failure) throw failure;
  }
  schedule(identity: LifecycleIdentity, clock: EventClock, at: number, priority: number, key: string, run: () => void) {
    const record = this.record(identity);
    if (record.state === "retired") throw Error("Retired lifecycle owner");
    const cancel = clock.schedule(at, priority, JSON.stringify([identity.id, identity.generation, key]), () => {
      record.cleanup.delete(cleanup);
      if (record.state !== "retired") run();
    });
    const cleanup = () => { cancel(); };
    record.cleanup.add(cleanup);
    return () => { record.cleanup.delete(cleanup); return cancel(); };
  }
  clock(identity: LifecycleIdentity, clock: EventClock): EventClock {
    return { get now() { return clock.now; }, schedule: (at, priority, key, run) => this.schedule(identity, clock, at, priority, key, run) };
  }
  snapshot() { return [...this.records.values()].map(r => ({ ...r.identity, state: r.state })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
}
