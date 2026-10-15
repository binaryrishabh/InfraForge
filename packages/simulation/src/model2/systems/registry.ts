import { requireKnown } from "../../reality/quantity";
import { copy } from "./copy";
import { messageClient } from "../async/client";
import type { ObjectReply } from "../async/contracts";
import type { Deliver } from "../compute/run";
import type { EventKernel } from "../time";
import type { BlobDescriptor, Manifest, RegistryConfig, SystemReply } from "./contracts";
import { systemService } from "./service";
import { SYSTEM_LIMITS } from "./policy";
export const digestIdentity = (s: string) => typeof s === "string" && /^sha256:[a-f0-9]{64}$/.test(s);
export function artifactRegistry(config: RegistryConfig, kernel: EventKernel, send: Deliver) {
  const blobs = new Map<string, BlobDescriptor>(), manifests = new Map<string, Manifest>(), tags = new Map<string, string>();
  let uploads = 0, deduplicated = 0, manifestWrites = 0, tagWrites = 0, manifestReads = 0, blobReads = 0, responseBytes = 0;
  const service = systemService(config.id, config, kernel, (work, done) => {
    const r = work.message?.request as { kind: string; digest?: string; bytes?: number; layers?: BlobDescriptor[]; tag?: string; reference?: string }, ask = messageClient(work, send);
    const reply = (value: SystemReply) => done(value);
    if (r.kind === "tag") {
      if (typeof r.tag !== "string" || !r.tag || r.tag.length > 253 || !manifests.has(r.digest!) || (!tags.has(r.tag) && tags.size >= SYSTEM_LIMITS.entries)) { reply({ ok: false, reason: "invalid-tag-reference" }); return; }
      tags.set(r.tag, r.digest!); tagWrites++; reply({ ok: true }); return;
    }
    if (r.kind === "manifest") {
      if (!digestIdentity(r.digest!) || !Number.isSafeInteger(r.bytes) || r.bytes! < 0 || !Array.isArray(r.layers) || !r.layers.length || r.layers.length > SYSTEM_LIMITS.manifestLayers || r.layers.some((b) => !b || !digestIdentity(b.digest) || !blobs.has(b.digest) || blobs.get(b.digest)!.bytes !== b.bytes) || (!manifests.has(r.digest!) && manifests.size >= SYSTEM_LIMITS.entries)) { reply({ ok: false, reason: "missing-or-invalid-manifest-blob" }); return; }
      const manifest: Manifest = { digest: r.digest!, bytes: r.bytes!, layers: r.layers.map((b) => ({ ...b })) }, previous = manifests.get(manifest.digest);
      if (previous && JSON.stringify(previous) !== JSON.stringify(manifest)) { reply({ ok: false, reason: "immutable-manifest-conflict" }); return; }
      manifests.set(manifest.digest, manifest); manifestWrites++; reply({ ok: true }); return;
    }
    if (r.kind === "resolve") {
      manifestReads++; const m = manifests.get(tags.get(r.reference!) ?? r.reference!); if (!m) { reply({ ok: false, reason: "manifest-not-found" }); return; }
      if (work.message) work.message.bodyBytes = { response: m.bytes }; responseBytes += m.bytes; reply({ ok: true, manifest: copy(m) }); return;
    }
    if (!digestIdentity(r.digest!)) { reply({ ok: false, reason: "invalid-digest" }); return; }
    if (r.kind === "blob") {
      blobReads++; const blob = blobs.get(r.digest!); if (!blob) { reply({ ok: false, reason: "blob-not-found" }); return; }
      const receipt = ask<ObjectReply>(config.store, { kind: "get", namespace: config.namespace, key: blob.digest }, (result, outcome) => {
        if (outcome !== "completed" || !result?.ok || result.object?.content !== blob.digest || result.object.bytes !== blob.bytes) { reply({ ok: false, reason: "blob-store-read-failed" }); return; }
        if (work.message) work.message.bodyBytes = { response: blob.bytes }; responseBytes += blob.bytes; reply({ ok: true, bytes: blob.bytes, content: blob.digest });
      }); return () => { receipt.cancel(); };
    }
    if (r.kind !== "upload" || !Number.isSafeInteger(r.bytes) || r.bytes! < 0 || (!blobs.has(r.digest!) && blobs.size >= SYSTEM_LIMITS.entries)) { reply({ ok: false, reason: "invalid-blob-upload" }); return; }
    const previous = blobs.get(r.digest!); if (previous && previous.bytes !== r.bytes) { reply({ ok: false, reason: "immutable-blob-conflict" }); return; }
    uploads++; let receipt = ask<ObjectReply>(config.store, { kind: "put", namespace: config.namespace, key: r.digest!, bytes: r.bytes!, content: r.digest!, ifAbsent: true }, (result, outcome) => {
      const commit = (reused: boolean) => { blobs.set(r.digest!, { digest: r.digest!, bytes: r.bytes! }); if (reused) deduplicated++; reply({ ok: true, reused }); };
      if (outcome === "completed" && result?.ok) { commit(false); return; }
      if (result?.reason !== "precondition-failed") { reply({ ok: false, reason: "blob-store-write-failed" }); return; }
      receipt = ask<ObjectReply>(config.store, { kind: "head", namespace: config.namespace, key: r.digest! }, (head, status) => {
        if (status === "completed" && head?.ok && head.object?.bytes === r.bytes && head.object?.content === r.digest) commit(true); else reply({ ok: false, reason: "blob-identity-conflict" });
      });
    }, r.bytes!); return () => { receipt.cancel(); };
  });
  return { ...service, evidence: () => ({ id: config.id, uploads, deduplicated, manifestWrites, tagWrites, manifestReads, blobReads, generatedResponseBodyBytes: responseBytes, blobBytes: [...blobs.values()].reduce((n, b) => n + b.bytes, 0), blobs: [...blobs.values()].map((b) => ({ ...b })), manifests: [...manifests.values()].map((m) => copy(m)), tags: Object.fromEntries(tags), service: service.serviceEvidence(), digestBoundary: "Authored SHA-256 content identities; byte hashing/verification CPU Unknown. Not full OCI conformance." }) };
}
