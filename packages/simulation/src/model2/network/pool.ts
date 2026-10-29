import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { ConnectionHook, ConnectionRoute, FailureReason, PoolConfig, Trace } from "./contracts";

export interface Lease { connection: string; route?: ConnectionRoute; release(): void; fail(reason: FailureReason): void }
interface Acquisition { id: string; ready(lease: Lease): void; fail(reason: FailureReason): void; timer?: () => boolean; connection?: Connection }
interface Connection { id: string; route?: ConnectionRoute; state: "connecting" | "ready" | "draining"; users: Map<string, Acquisition>; reserved: Map<string, Acquisition>; timers: Array<() => boolean>; expiry?: () => boolean; uses: number }
export function connectionPool(id: string, config: PoolConfig, kernel: EventKernel, reachable: (route?: ConnectionRoute) => boolean, trace?: Trace, hook?: ConnectionHook) {
  const connections = new Map<string, Connection>(), waiting = new Map<string, Acquisition>();
  const max = requireKnown(config.maxConnections, "count"), streams = requireKnown(config.streams, "count"), limit = requireKnown(config.pending, "count");
  let sequence = 0, created = 0, closed = 0, failed = 0, acquisitions = 0, released = 0, failedStreams = 0, reused = 0, rejected = 0, cancelled = 0, pumping = false, draining = false;
  const removeConnection = (c: Connection, reason?: FailureReason) => {
    if (!connections.delete(c.id)) return;
    c.timers.forEach((cancel) => cancel()); c.expiry?.(); hook?.close(c.id); closed++; if (reason) failed++;
    trace?.("connection-closed", c.id, reason ?? "closed", undefined, undefined, !!config.evidenceProfile);
    failedStreams += c.users.size;
    const owners = [...c.users.values(), ...c.reserved.values()]; c.users.clear(); c.reserved.clear();
    for (const a of owners) { a.timer?.(); waiting.delete(a.id); a.fail(reason ?? "drained"); }
  };
  const idle = (c: Connection) => {
    if (c.users.size || c.reserved.size || c.state === "connecting") return;
    if (!config.reuse || c.state === "draining" || draining) { removeConnection(c); return; }
    if (config.idleTimeout) c.expiry = kernel.schedule(kernel.now + requireKnown(config.idleTimeout, "us"), 1, JSON.stringify(["pool-idle", id, c.id]), () => { removeConnection(c); pump(); });
  };
  const activate = (c: Connection, a: Acquisition) => {
    waiting.delete(a.id); c.reserved.delete(a.id); a.timer?.(); c.expiry?.(); c.expiry = undefined;
    if (c.uses++) reused++; acquisitions++; c.users.set(a.id, a);
    let live = true;
    a.ready({ connection: c.id, route: c.route, release() {
      if (!live) return; live = false;
      if (c.users.delete(a.id)) { released++; if (config.evidenceProfile) trace?.("connection-released", a.id, c.id, undefined, undefined, true); } idle(c); pump();
    }, fail(reason) { if (live) { live = false; removeConnection(c, reason); pump(); } } });
  };
  const create = () => {
    const c: Connection = { id: JSON.stringify([id, sequence++]), state: "connecting", users: new Map(), reserved: new Map(), timers: [], uses: 0 };
    connections.set(c.id, c); created++;
    trace?.("connection-created", c.id, id);
    c.timers.push(kernel.schedule(kernel.now + requireKnown(config.connectTimeout, "us"), 1, JSON.stringify(["pool-connect-timeout", c.id]), () => { removeConnection(c, "connect-timeout"); pump(); }));
    const establish = () => c.timers.push(kernel.schedule(kernel.now + requireKnown(config.establish, "us"), 2, JSON.stringify(["pool-connect-ready", c.id]), () => {
      if (!reachable(c.route)) return; // Silent establishment failure remains owned by its timeout.
      c.timers.forEach((cancel) => cancel()); c.state = "ready";
      trace?.("connection-ready", c.id, id);
      for (const a of [...c.reserved.values()]) if (waiting.has(a.id)) activate(c, a);
      idle(c); pump();
    }));
    if (hook) c.timers.push(kernel.schedule(kernel.now, 2, JSON.stringify(["pool-connect-gate", c.id]), () => {
      c.timers.push(hook.open(c.id, (route, failure) => {
        if (!connections.has(c.id)) return;
        if (failure) { removeConnection(c, failure); pump(); return; }
        c.route = route; establish();
      }));
    })); else establish();
    return c;
  };
  const pump = () => {
    if (pumping || draining) return;
    pumping = true;
    for (const a of waiting.values()) {
      if (a.connection) continue;
      let c = [...connections.values()].find((c) => c.state === "ready" && c.users.size < streams && (config.reuse || c.uses === 0));
      if (c) { activate(c, a); continue; }
      c = [...connections.values()].find((c) => c.state === "connecting" && c.reserved.size < streams);
      if (!c && connections.size < max) c = create();
      if (!c) break;
      c.reserved.set(a.id, a); a.connection = c;
    }
    pumping = false;
  };
  return {
    acquire(key: string, ready: Acquisition["ready"], fail: Acquisition["fail"]) {
      if (waiting.has(key) || [...connections.values()].some((c) => c.users.has(key))) throw new Error("Duplicate pool owner");
      const canReserve = [...connections.values()].some((c) => c.state !== "draining" && (c.state === "connecting" ? c.reserved.size < streams : c.users.size < streams && (config.reuse || c.uses === 0))) || connections.size < max;
      if (draining || (!canReserve && waiting.size >= limit)) { rejected++; fail(draining ? "drained" : "pool-overflow"); return () => false; }
      const a: Acquisition = { id: key, ready, fail };
      a.timer = kernel.schedule(kernel.now + requireKnown(config.acquireTimeout, "us"), 1, JSON.stringify(["pool-acquire-timeout", id, key]), () => {
        if (!waiting.delete(key)) return; a.connection?.reserved.delete(key); fail("acquire-timeout"); pump();
      }); waiting.set(key, a); pump();
      return () => { if (!waiting.delete(key)) return false; a.timer?.(); a.connection?.reserved.delete(key); cancelled++; pump(); return true; };
    },
    reset(reason: FailureReason = "reset") { for (const c of [...connections.values()]) removeConnection(c, reason); pump(); },
    drain(grace: number) {
      if (draining) return; draining = true;
      for (const a of [...waiting.values()]) { a.timer?.(); waiting.delete(a.id); a.connection?.reserved.delete(a.id); a.fail("drained"); }
      for (const c of [...connections.values()]) {
        c.state = "draining"; c.timers.forEach((cancel) => cancel()); idle(c);
        if (connections.has(c.id)) c.timers.push(kernel.schedule(kernel.now + grace, 1, JSON.stringify(["pool-drain", id, c.id]), () => removeConnection(c, "drained")));
      }
    },
    measure() {
      const cs = [...connections.values()];
      return { id, draining, connections: cs.length, connecting: cs.filter((c) => c.state === "connecting").length,
        idle: cs.filter((c) => c.state === "ready" && !c.users.size).length, active: cs.filter((c) => c.state === "ready" && c.users.size > 0).length,
        drainingConnections: cs.filter((c) => c.state === "draining").length, activeStreams: cs.reduce((n, c) => n + c.users.size, 0),
        pending: waiting.size, created, closed, failedConnections: failed, acquired: acquisitions, released, failedStreams, reused, rejected, cancelled,
        pendingUnassigned: [...waiting.values()].filter((a) => !a.connection).length };
    },
  };
}
