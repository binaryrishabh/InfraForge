import { requireKnown } from "../../reality/quantity";
import type { EventKernel } from "../time";
import type { Deliver } from "../compute/run";
import type { Invocation, Receipt, RemoteOutcome } from "../workload/contracts";
import type { PublisherConfig, ObjectReply, QueueReply } from "./contracts";
import { messageClient } from "./client";
export function asyncPublisher(config: PublisherConfig, kernel: EventKernel, send: Deliver) {
  let received = 0, completed = 0, failed = 0, publishAttempts = 0, ambiguous = 0, uploaded = 0; const live = new Set<string>();
  return {
    accept(work: Invocation, done: (o: RemoteOutcome) => void): Receipt {
      received++; live.add(work.callId); const request = messageClient(work, send), logicalId = work.rootId, key = work.rootId;
      const finish = (ok: boolean) => { live.delete(work.callId); if (ok) completed++; else failed++; done(ok ? "completed" : "rejected"); };
      request<ObjectReply>(config.store, { kind: "put", namespace: config.namespace, key, bytes: requireKnown(config.objectBytes, "bytes"), content: logicalId }, (reply) => {
        if (!reply?.ok) { finish(false); return; } uploaded++; let attempt = 0;
        const publish = () => { attempt++; publishAttempts++; request<QueueReply>(config.broker, { kind: "publish", logicalId, body: { key, namespace: config.namespace, objectKey: key, bytes: requireKnown(config.messageBytes, "bytes") }, delayUs: requireKnown(config.delay, "us") }, (reply, outcome) => {
          if (outcome === "completed" && reply?.ok) { finish(true); return; }
          if (!reply) ambiguous++; if (attempt < requireKnown(config.publishAttempts, "count")) publish(); else finish(false);
        }, requireKnown(config.messageBytes, "bytes")); }; publish();
      }, requireKnown(config.objectBytes, "bytes"));
      return { admitted: true, state: () => live.has(work.callId) ? "waiting" : "finished", cancel: () => live.has(work.callId) ? "unsupported" : "already-finished" };
    },
    pause() { throw Error("Publisher process failure policy is unmodeled"); },
    measure: () => ({ id: config.id, paused: false, received, admitted: received, rejected: 0, completed, failed, cancelled: 0, queued: 0, serving: 0, waiting: live.size, consumedCoreUs: 0, busySlotUs: 0 }),
    evidence: () => ({ id: config.id, received, completed, failed, live: live.size, uploaded, publishAttempts, ambiguousPublishes: ambiguous, confirmationMeaning: "Broker logical ownership acknowledged over response transport; physical durability Unknown", now: kernel.now }),
  };
}
