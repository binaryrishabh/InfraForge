import { requireKnown } from "../../reality/quantity";
import { commandService } from "../async/commands";
import { messageClient } from "../async/client";
import type { QueueReply } from "../async/contracts";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt } from "../workload/contracts";
import type { EventBusConfig, EventPublish } from "./contracts";
import type { MessageBody } from "../messaging/contracts";

interface Pending { id: number; work: Invocation; event: EventPublish; attempts: number; cancel?: () => boolean; receipt?: Receipt }
export function eventBus(config: EventBusConfig, clock: EventKernel, send: Deliver) {
  const capacity = requireKnown(config.capacityMessages, "count"), attempts = requireKnown(config.maxAttempts, "count");
  const retry = requireKnown(config.retryDelay, "us"), timeout = requireKnown(config.deliveryTimeout, "us"), dlqLimit = requireKnown(config.deadLetterCapacity, "count");
  const subscriptions = [...config.subscriptions].sort((a, b) => a.id < b.id ? -1 : 1).map(spec => ({ spec, live: new Map<number, Pending>(), accepted: 0, delivered: 0, retried: 0, discarded: 0, filtered: 0, deadLettered: 0, deadLetterOverflow: 0, attempts: 0, failedAttempts: 0, deadLetters: [] as Array<{ logicalId: string; body: MessageBody; attempts: number; reason: string; atUs: number }> }));
  let accepted = 0, invalid = 0, paused = false;
  const rows: Array<{ atUs: number; subscription: string; delivery: number; attempt: number; outcome: string }> = []; let omitted = 0;
  const record = (subscription: string, p: Pending, outcome: string) => { if (rows.length < 2048) rows.push({ atUs: clock.now, subscription, delivery: p.id, attempt: p.attempts, outcome }); else omitted++; };
  const dispatch = (s: typeof subscriptions[number], p: Pending) => {
    p.attempts++; s.attempts++; if (p.attempts > 1) s.retried++;
    let settled = false;
    const settle = (ok: boolean, reason: string) => {
      if (settled) return; settled = true; p.cancel?.(); p.cancel = undefined;
      record(s.spec.id, p, reason);
      if (ok) { s.live.delete(p.id); s.delivered++; return; }
      s.failedAttempts++;
      if (p.attempts >= attempts) {
        s.live.delete(p.id);
        if (s.deadLetters.length < dlqLimit) { s.deadLettered++; s.deadLetters.push({ logicalId: p.event.logicalId, body: { ...p.event.body }, attempts: p.attempts, reason, atUs: clock.now }); }
        else { s.discarded++; s.deadLetterOverflow++; }
      } else {
        // Recovery (-1) and fault start (0) precede timeout (1) and retry (2).
        // Recovery keeps pending ownership and never brings a scheduled retry forward.
        p.cancel = clock.schedule(clock.now + retry, 2, JSON.stringify(["event-bus-retry", config.id, s.spec.id, p.id, p.attempts]), () => dispatch(s, p));
      }
    };
    p.cancel = clock.schedule(clock.now + timeout, 1, JSON.stringify(["event-bus-timeout", config.id, s.spec.id, p.id, p.attempts]), () => { settle(false, "delivery-timeout-ambiguous"); p.receipt?.cancel(); });
    if (paused) { settle(false, "service-unavailable"); return; }
    // Retries preserve logical identity; only the destination queue's deduplication
    // and the worker's explicit result policy can suppress duplicate effects.
    const parent = { ...p.work, callId: JSON.stringify(["event-bus", config.id, s.spec.id, p.id, p.attempts]) };
    p.receipt = messageClient(parent, send)<QueueReply>(s.spec.target, { ...p.event, delayUs: 0, body: { ...p.event.body } }, (reply, outcome) => settle(outcome === "completed" && reply?.ok === true, outcome === "completed" && reply?.ok ? "delivered" : reply?.reason ?? "delivery-failed-ambiguous"), p.event.body.bytes);
  };
  const validText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 1024;
  const service = commandService(config.id, config, clock, work => {
    const event = work.message?.request as EventPublish | undefined, b = event?.body;
    if (event?.kind !== "publish" || !validText(event.logicalId) || !b || ![b.key, b.namespace, b.objectKey].every(validText) || !Number.isSafeInteger(b.bytes) || b.bytes < 0 || b.bytes > 1048576 || (event.delayUs !== undefined && event.delayUs !== 0)) { invalid++; return { ok: false, reason: "invalid-event" }; }
    const id = ++accepted;
    for (const s of subscriptions) {
      if (s.spec.keyPrefix !== undefined && !b.key.startsWith(s.spec.keyPrefix)) { s.filtered++; continue; }
      if (s.live.size >= capacity) { s.discarded++; continue; }
      const p: Pending = { id, work: { ...work, message: undefined }, event: { kind: "publish", logicalId: event.logicalId, body: { ...b } }, attempts: 0 };
      s.live.set(id, p); s.accepted++;
      p.cancel = clock.schedule(clock.now, 2, JSON.stringify(["event-bus-deliver", config.id, s.spec.id, id]), () => dispatch(s, p));
    }
    return { ok: true, acceptedId: String(id), durability: "logical-ownership-only" };
  });
  return { ...service, pause(value: boolean) { paused = value; service.pause(value); }, evidence: () => ({ id: config.id, accepted, invalid, subscriptions: subscriptions.map(s => ({ id: s.spec.id, target: s.spec.target, accepted: s.accepted, delivered: s.delivered, retried: s.retried, discarded: s.discarded, filtered: s.filtered, pending: s.live.size, deadLettered: s.deadLettered, deadLetterOverflow: s.deadLetterOverflow, deliveryAccounting: { attempts: s.attempts, failedAttempts: s.failedAttempts, exhausted: s.deadLettered + s.deadLetterOverflow }, deadLetters: s.deadLetters.map(d => ({ ...d, body: { ...d.body } })) })), events: rows.map(r => ({ ...r })), omitted, service: service.evidence(), guarantee: "Unordered logical fan-out; duplicate delivery possible; physical durability Unknown; queue deduplication and worker idempotency are separate boundaries" }) };
}
