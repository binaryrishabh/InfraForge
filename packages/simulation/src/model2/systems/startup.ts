import { requireKnown } from "../../reality/quantity";
import { messageClient } from "../async/client";
import type { Deliver } from "../compute/run";
import type { NetworkContext } from "../network/run";
import type { EventKernel } from "../time";
import type { Invocation, Receipt } from "../workload/contracts";
import type { BlobDescriptor, StartupConfig, SystemReply } from "./contracts";
import { systemService } from "./service";
import { eventRows, SYSTEM_LIMITS } from "./policy";
export function artifactClient(config: StartupConfig, kernel: EventKernel, send: Deliver, operation: string) {
  const cache = new Map<string, number>(), replicas = new Map(config.replicas.map((r) => [r.id, { ...r, state: "pending" as "pending" | "pulling" | "failed" | "running", attempts: 0, readyAt: null as number | null, resolvedDigest: null as string | null, requiredLayers: [] as BlobDescriptor[] }]));
  const events = eventRows(); let bytes = 0, pulled = 0, reused = 0, failures = 0;
  const service = systemService(config.id, config, kernel, (work, done) => {
    const request = work.message?.request as { kind: string; replica: string }, replica = replicas.get(request.replica)!;
    if (!replica || replica.state === "running") { done({ ok: !!replica, reason: replica ? undefined : "missing-replica" }); return; }
    replica.state = "pulling"; const ask = messageClient(work, send); let receipt: Receipt | undefined;
    const fail = (reason: string) => { failures++; replica.state = "failed"; events.add(kernel.now, "startup-failed", replica.id, reason); done({ ok: false, reason }); };
    receipt = ask<SystemReply>(config.registry, { kind: "resolve", reference: replica.reference }, (reply, status) => {
      if (status !== "completed" || !reply?.ok || !reply.manifest) { fail("manifest-unavailable"); return; }
      replica.resolvedDigest = reply.manifest.digest; replica.requiredLayers = reply.manifest.layers.map((b) => ({ ...b }));
      const layers = reply.manifest.layers; let index = 0;
      const next = () => {
        while (index < layers.length && cache.get(layers[index]!.digest) === layers[index]!.bytes) { reused++; index++; }
        if (index === layers.length) { replica.state = "running"; replica.readyAt = kernel.now; events.add(kernel.now, "artifacts-ready", replica.id, reply.manifest!.digest); done({ ok: true }); return; }
        const layer = layers[index++]!;
        if (bytes + layer.bytes > requireKnown(config.cacheBytes, "bytes") || cache.size >= SYSTEM_LIMITS.entries) { fail("node-blob-cache-capacity"); return; }
        receipt = ask<SystemReply>(config.registry, { kind: "blob", digest: layer.digest }, (blob, outcome) => {
          if (outcome !== "completed" || !blob?.ok || blob.content !== layer.digest || blob.bytes !== layer.bytes) { fail("layer-unavailable"); return; }
          pulled += layer.bytes;
          if (!cache.has(layer.digest)) { if (bytes + layer.bytes > requireKnown(config.cacheBytes, "bytes") || cache.size >= SYSTEM_LIMITS.entries) { fail("node-blob-cache-capacity"); return; } cache.set(layer.digest, layer.bytes); bytes += layer.bytes; } next();
        });
      }; next();
    }); return () => { receipt?.cancel(); };
  });
  return { ...service, start(context: NetworkContext, horizon: number) {
    for (const r of replicas.values()) {
      context.setReady(r.target, false);
      const attempt = () => {
        if (kernel.now >= horizon || r.state === "running") return;
        r.attempts++;
        const work: Invocation = { rootId: JSON.stringify(["startup", config.id, r.id]), callId: JSON.stringify(["startup", config.id, r.id, r.attempts]), attempt: r.attempts, operation, offeredAt: kernel.now, message: { request: { kind: "start", replica: r.id } } };
        service.accept(work, (outcome) => {
          if (outcome === "completed") context.setReady(r.target, true);
          else { r.state = "failed"; if (r.attempts < requireKnown(config.attempts, "count")) { const at = kernel.now + requireKnown(config.backoff, "us"); if (at < horizon) kernel.schedule(at, 2, JSON.stringify(["startup-retry", config.id, r.id, r.attempts]), attempt); } }
        });
      };
      kernel.schedule(requireKnown(r.at, "us"), 2, JSON.stringify(["startup", config.id, r.id]), attempt);
    }
  }, evidence: () => ({ id: config.id, cache: [...cache.entries()].map(([digest, bytes]) => ({ digest, bytes })), cachedBytes: bytes, pulledBytes: pulled, reusedLayers: reused, failures, replicas: [...replicas.values()].map((r) => ({ ...r })), service: service.serviceEvidence(), events: events.snapshot() }) };
}
