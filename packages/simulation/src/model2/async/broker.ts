import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Invocation } from "../workload/contracts";
import type { BrokerConfig, QueueRequest, QueueReply, Delivery, MessageBody } from "./contracts";
import { commandService } from "./commands";
import { ASYNC_LIMITS } from "./policy";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
interface Message { id: string; logicalId: string; publishAttempt: string; body: MessageBody; acceptedAt: number; expiresAt: number; attempts: number; state: "ready" | "scheduled" | "in-flight"; delivery?: Delivery; cancelExpiry?: () => boolean; cancelLease?: () => boolean; cancelDelay?: () => boolean }
export function deliveryQueue(config: BrokerConfig, kernel: EventKernel) {
  const live = new Map<string, Message>(), ready = new Map<string, Message>(), dlq = new Map<string, { message: Omit<Message, "cancelExpiry" | "cancelLease" | "cancelDelay">; reason: string; at: number }>(), dedup = new Map<string, { id: string; body: string }>();
  const consumers = new Map(config.consumers.map((c) => [c.id, { credit: requireKnown(c.credit, "count"), outstanding: new Set<string>() }]));
  let accepted = 0, duplicatePublishes = 0, rejectedPublishes = 0, acknowledged = 0, discarded = 0, expired = 0, deadLettered = 0, dlqOverflow = 0, used = 0, dlqUsed = 0, delivered = 0, redelivered = 0, leaseExpired = 0, nacked = 0, staleReceipts = 0;
  const events: Array<{ at: number; kind: string; message: string; delivery?: string; reason?: string }> = []; let omitted = 0;
  const record = (kind: string, m: Message, reason?: string) => { if (events.length < ASYNC_LIMITS.evidenceRows) events.push({ at: kernel.now, kind, message: m.id, delivery: m.delivery?.receipt, reason }); else omitted++; };
  const release = (m: Message) => { if (m.delivery) consumers.get(m.delivery.consumer)!.outstanding.delete(m.id); m.cancelLease?.(); m.delivery = undefined; };
  const terminal = (m: Message, kind: "acked" | "discarded" | "expired" | "dead-lettered", reason: string) => {
    if (!live.has(m.id)) return; record(kind, m, reason); release(m); m.cancelExpiry?.(); m.cancelDelay?.(); live.delete(m.id); ready.delete(m.id); used -= m.body.bytes;
    if (kind === "acked") acknowledged++; else if (kind === "expired") expired++; else if (kind === "discarded") discarded++; else {
      if (dlq.size >= requireKnown(config.dlqMessages, "count") || dlqUsed + m.body.bytes > requireKnown(config.dlqBytes, "bytes")) { discarded++; dlqOverflow++; return; }
      const { cancelExpiry: _expiry, cancelLease: _lease, cancelDelay: _delay, ...message } = m; dlq.set(m.id, { message: copy(message), reason, at: kernel.now }); dlqUsed += m.body.bytes; deadLettered++;
    }
  };
  const requeue = (m: Message, reason: string) => {
    if (m.attempts >= requireKnown(config.maxAttempts, "count")) { terminal(m, "dead-lettered", "attempt-limit"); return; }
    record("requeue", m, reason); release(m); m.state = "ready"; ready.set(m.id, m);
  };
  const valid = (s: string | undefined) => typeof s === "string" && s.length > 0 && s.length <= ASYNC_LIMITS.keyCharacters;
  const apply = (work: Invocation): QueueReply => {
    const r = work.message?.request as QueueRequest | undefined; if (!r) return { ok: false, reason: "missing-queue-command" };
    if (r.kind === "publish") {
      const b = r.body;
      if (!valid(r.logicalId) || !b || ![b.key, b.namespace, b.objectKey].every(valid) || !Number.isSafeInteger(b.bytes) || b.bytes < 0 || !Number.isSafeInteger(r.delayUs) || r.delayUs! < 0 || !Number.isSafeInteger(kernel.now + r.delayUs! + requireKnown(config.retention, "us"))) { rejectedPublishes++; return { ok: false, reason: "invalid-publish" }; }
      const bodyIdentity = JSON.stringify([b.key, b.namespace, b.objectKey, b.bytes]), old = config.deduplicatePublishes ? dedup.get(r.logicalId!) : undefined;
      if (old) { if (old.body !== bodyIdentity) { rejectedPublishes++; return { ok: false, reason: "dedup-content-conflict" }; } duplicatePublishes++; return { ok: true, acceptedId: old.id, deduplicated: true, durability: "logical-ownership-only" }; }
      if (live.size >= requireKnown(config.capacityMessages, "count") || used + b.bytes > requireKnown(config.capacityBytes, "bytes") || (config.deduplicatePublishes && dedup.size >= ASYNC_LIMITS.messages)) { rejectedPublishes++; return { ok: false, reason: "broker-capacity" }; }
      const id = JSON.stringify([r.logicalId, work.callId]); if (live.has(id) || dlq.has(id)) { rejectedPublishes++; return { ok: false, reason: "duplicate-publish-attempt" }; }
      const m: Message = { id, logicalId: r.logicalId!, publishAttempt: work.callId, body: { ...b }, acceptedAt: kernel.now, expiresAt: kernel.now + requireKnown(config.retention, "us"), attempts: 0, state: r.delayUs ? "scheduled" : "ready" };
      live.set(id, m); accepted++; used += b.bytes; record("accepted", m); if (config.deduplicatePublishes) dedup.set(m.logicalId, { id, body: bodyIdentity });
      m.cancelExpiry = kernel.schedule(m.expiresAt, 0, JSON.stringify(["message-expiry", config.id, id]), () => terminal(m, "expired", "retention"));
      if (r.delayUs) m.cancelDelay = kernel.schedule(kernel.now + r.delayUs, 2, JSON.stringify(["message-ready", config.id, id]), () => { if (live.has(id)) { m.state = "ready"; ready.set(id, m); } }); else ready.set(id, m);
      return { ok: true, acceptedId: id, durability: "logical-ownership-only" };
    }
    const consumer = r.consumer && consumers.get(r.consumer); if (!consumer) return { ok: false, reason: "unknown-consumer" };
    if (r.kind === "nack" && !["requeue", "discard", "dead-letter"].includes(r.action!)) return { ok: false, reason: "missing-nack-policy" };
    if (r.kind === "receive") {
      if (consumer.outstanding.size >= consumer.credit) return { ok: false, reason: "consumer-credit" };
      const m = ready.values().next().value; if (!m) return { ok: true, empty: true };
      ready.delete(m.id); m.state = "in-flight"; m.attempts++; delivered++; if (m.attempts > 1) redelivered++;
      const d: Delivery = { id: m.id, logicalId: m.logicalId, publishAttempt: m.publishAttempt, attempt: m.attempts, consumer: r.consumer!, receipt: JSON.stringify([config.id, m.id, m.attempts]), deliveredAt: kernel.now, leaseUntil: kernel.now + requireKnown(config.lease, "us"), body: { ...m.body } };
      m.delivery = d; consumer.outstanding.add(m.id); record("delivery", m);
      m.cancelLease = kernel.schedule(d.leaseUntil, 0, JSON.stringify(["delivery-expiry", d.receipt]), () => { leaseExpired++; requeue(m, "lease-expired"); });
      if (work.message) work.message.bodyBytes = { response: m.body.bytes }; return { ok: true, delivery: copy(d) };
    }
    const m = [...consumer.outstanding].map((id) => live.get(id)!).find((m) => m.delivery?.receipt === r.receipt);
    if (!m) { staleReceipts++; return { ok: false, reason: "stale-receipt" }; }
    if (r.kind === "ack") { terminal(m, "acked", "consumer-ack"); return { ok: true }; }
    if (r.kind === "nack") { nacked++; if (r.action === "requeue") requeue(m, "consumer-nack"); else terminal(m, r.action === "dead-letter" ? "dead-lettered" : "discarded", "consumer-nack"); return { ok: true }; }
    return { ok: false, reason: "unsupported-queue-command" };
  };
  const service = commandService(config.id, config, kernel, apply);
  const snapshot = (m: Message) => ({ id: m.id, logicalId: m.logicalId, publishAttempt: m.publishAttempt, body: { ...m.body }, state: m.state, attempts: m.attempts, acceptedAt: m.acceptedAt, expiresAt: m.expiresAt, delivery: m.delivery ? copy(m.delivery) : undefined });
  return { ...service, inspectQueue: () => ({ accepted, dlqOverflow, ready: ready.size, inFlight: [...live.values()].filter((m) => m.state === "in-flight").length, redelivered, deadLettered, oldestReadyAgeUs: ready.size ? Math.max(...[...ready.values()].map((m) => kernel.now - m.acceptedAt)) : null }), evidence: () => ({ id: config.id, accepted, duplicatePublishes, rejectedPublishes, ready: ready.size, inFlight: [...live.values()].filter((m) => m.state === "in-flight").length, scheduled: [...live.values()].filter((m) => m.state === "scheduled").length, acknowledged, discarded, expired, deadLettered, dlqOverflow, liveBytes: used, dlqBytes: dlqUsed, deliveries: delivered, redelivered, leaseExpired, nacked, staleReceipts, oldestReadyAgeUs: ready.size ? Math.max(...[...ready.values()].map((m) => kernel.now - m.acceptedAt)) : null, messages: [...live.values()].map(snapshot), dlq: [...dlq.values()].map((d) => copy(d)), consumers: [...consumers].map(([id, c]) => ({ id, credit: c.credit, outstanding: [...c.outstanding] })), events: [...events], omitted, service: service.evidence(), physicalPersistence: "Unknown; pause retains logical state only" }) };
}
