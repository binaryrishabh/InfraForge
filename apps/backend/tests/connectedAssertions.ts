import { strict as assert } from "node:assert";
import { decodeCausal } from "../internalModel2/causalJournal";
import type { StoredCaptureV2 } from "../internalModel2/captureV2";
export function verifyConnectedState(e: StoredCaptureV2) {
  const m = e.model, c = m.counts;
  assert.equal(c.offered, c.completed + c.rejected + c.deadlineExceeded + c.abandoned + c.inFlight);
  assert.equal(m.callers.retention.terminal, m.callers.results.length + m.callers.retention.omitted);
  for (const r of m.resources) {
    assert.equal(r.received, r.admitted + r.rejected);
    assert.equal(r.admitted, r.completed + r.failed + r.cancelled + r.queued + r.serving + r.waiting);
  }
  for (const d of m.database) {
    assert.equal(d.sessions.total, d.sessions.active + d.sessions.idle); assert(d.sessions.total <= d.sessions.limit);
    assert.equal(d.transactions.admitted, d.transactions.committed + d.transactions.aborted + d.transactions.cancelled + d.transactions.live);
    assert.equal(d.transactions.committed, Object.values(d.queryClasses).reduce((n, v) => n + v.committed, 0));
  }
  for (const p of m.network.paths) {
    assert.equal(p.offered, p.completed + p.failed + p.cancelled + p.live);
    assert.equal(p.pool.acquired, p.pool.released + p.pool.failedStreams + p.pool.activeStreams);
  }
  for (const l of m.network.links) { assert(Math.abs(l.offeredBytes - l.acceptedBytes - l.rejectedBytes) < 1e-5); assert(Math.abs(l.acceptedBytes - l.deliveredBytes - l.failedBytes - l.liveBytes) < 1e-5); }
  const events = decodeCausal(m.causal);
  if (!e.completeness.exactCausality) return { complete: false, events: events.length };
  assert.equal(m.causal.omitted, 0);
  const calls = events.filter(v => v.kind === "caller-terminal"); assert.equal(calls.length, m.callers.results.length);
  for (const result of m.callers.results) {
    const terminal = calls.filter(v => v.work?.callId === result.callId); assert.equal(terminal.length, 1);
    assert.equal(terminal[0]!.detail.outcome, result.outcome); assert.equal(terminal[0]!.atUs, result.at);
    if (result.outcome !== "completed") continue;
    const root = result.rootId, selected = events.find(v => v.kind === "lb-selected" && v.detail.root === root); assert(selected);
    const app = events.find(v => v.kind === "app-admitted" && v.work?.callId === selected.detail.id); assert(app);
    const dependency = events.find(v => v.kind === "app-dependency" && v.work?.parentCallId === app.work!.callId); assert(dependency);
    const db = events.find(v => v.kind === "db-admitted" && v.work?.callId === dependency.work!.callId); assert(db); assert.equal(db.work!.rootId, root); assert.equal(db.resource, "db"); assert.equal(typeof db.detail.session, "string");
    assert(events.some(v => v.kind === "caller-offered" && v.work?.callId === result.callId));
    assert(events.some(v => v.kind === "lb-received" && v.work?.callId === result.callId));
    for (const [call, target] of [[result.callId, "lb"], [app.work!.callId, app.resource], [db.work!.callId, "db"]]) {
      assert(events.some(v => v.kind === "request-delivered" && v.detail.id === call && v.detail.detail === target));
      assert(events.some(v => v.kind === "transport-terminal" && v.detail.id === call && v.detail.detail === "completed"));
    }
    assert(events.some(v => v.kind === "db-terminal" && v.work?.callId === db.work!.callId && v.detail.outcome === "committed"));
    assert(events.some(v => v.kind === "app-terminal" && v.work?.callId === app.work!.callId && v.detail.outcome === "completed"));
    assert(events.some(v => v.kind === "transport-terminal" && v.detail.id === result.callId && v.detail.detail === "completed"));
  }
  assert.equal(events.filter(v => v.kind === "db-admitted").length, m.database[0]!.transactions.admitted);
  assert.equal(events.filter(v => v.kind === "db-terminal" && v.detail.outcome === "committed").length, m.database[0]!.transactions.committed);
  // Cached LB health, not omniscient process availability, owns selection eligibility.
  const health = new Map(m.routing[0]!.backends.map(b => [b.id, true]));
  for (const v of events) {
    if (v.kind === "health-observation") { const id = JSON.parse(String(v.detail.id))[2]; health.set(id, String(v.detail.detail).endsWith("eligible=true")); }
    if (v.kind === "lb-selected") assert.equal(health.get(String(v.detail.detail)), true);
  }
  return { complete: true, events: events.length, completedChains: m.callers.results.filter(v => v.outcome === "completed").length };
}
