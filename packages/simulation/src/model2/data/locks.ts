import { lexical } from "../time";
interface Waiter { owner: string; key: string; mode: "shared" | "exclusive"; grant(): void; deadlock(): void }
export function lockManager() {
  const held = new Map<string, Map<string, "shared" | "exclusive"> >(), owned = new Map<string, Set<string>>(), waiting = new Map<string, Waiter>();
  let grants = 0, waits = 0, deadlocks = 0, pumping = false;
  const blockers = (w: Waiter) => {
    const ids = new Set([...(held.get(w.key) ?? [])].filter(([id, mode]) => id !== w.owner && (w.mode === "exclusive" || mode === "exclusive")).map(([id]) => id));
    // FIFO is also a dependency: an upgrade behind a queued writer can deadlock.
    for (const earlier of waiting.values()) { if (earlier.owner === w.owner) break; if (earlier.key === w.key && (earlier.mode === "exclusive" || w.mode === "exclusive")) ids.add(earlier.owner); }
    return [...ids];
  };
  const cycle = (owner: string, seen = new Set<string>()): boolean => {
    const visit = (id: string): boolean => {
      if (id === owner && seen.size) return true;
      if (seen.has(id)) return false; seen.add(id);
      const w = waiting.get(id); return !!w && blockers(w).some(visit);
    }; return visit(owner);
  };
  const grant = (w: Waiter) => { const owners = held.get(w.key) ?? new Map(); owners.set(w.owner, w.mode); held.set(w.key, owners); const keys = owned.get(w.owner) ?? new Set(); keys.add(w.key); owned.set(w.owner, keys); grants++; waiting.delete(w.owner); w.grant(); };
  const pump = () => {
    if (pumping) return; pumping = true;
    let progress: boolean;
    do { progress = false; for (const w of [...waiting.values()]) if (waiting.has(w.owner) && !blockers(w).length) { grant(w); progress = true; } } while (progress);
    pumping = false;
  };
  return {
    acquire(owner: string, key: string, mode: "shared" | "exclusive", ready: () => void, deadlock: () => void) {
      if (waiting.has(owner)) throw new Error("Transaction already waiting for a lock");
      const existing = held.get(key)?.get(owner);
      if (existing === "exclusive" || existing === mode) { ready(); return; }
      const w = { owner, key, mode, grant: ready, deadlock };
      if (!blockers(w).length) { grant(w); return; }
      waits++; waiting.set(owner, w);
      if (cycle(owner)) { deadlocks++; waiting.delete(owner); deadlock(); }
    },
    release(owner: string) { waiting.delete(owner); for (const key of owned.get(owner) ?? []) { const owners = held.get(key)!; owners.delete(owner); if (!owners.size) held.delete(key); } owned.delete(owner); pump(); },
    measure: () => ({ grants, waits, deadlocks, held: [...held].sort(([a], [b]) => lexical(a, b)).map(([key, owners]) => ({ key, owners: [...owners].sort(([a], [b]) => lexical(a, b)).map(([owner, mode]) => ({ owner, mode })) })) }),
    waiters: () => [...waiting.values()].map((w) => ({ owner: w.owner, key: w.key, mode: w.mode, blockers: blockers(w) })),
  };
}
