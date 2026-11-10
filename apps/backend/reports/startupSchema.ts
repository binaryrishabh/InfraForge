import { z } from "zod";

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const n = count.nullable().optional(), text = z.string().min(1).max(1024), t = text.nullable().optional();
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), d = digest.nullable().optional();
const b = z.boolean().nullable().optional();
const layer = z.object({digest, bytes: count}).strict();
const rows = <T>(s: z.ZodType<T>) => z.array(s).max(100).nullable().optional();
const events = rows(z.object({at: count, kind: text, id: text, detail: text}).strict());
const registry = z.object({id: text, uploads: n, deduplicated: n, manifestWrites: n, tagWrites: n, manifestReads: n, blobReads: n,
  generatedResponseBodyBytes: n, blobBytes: n, blobs: rows(layer), omittedBlobs: n,
  manifests: rows(layer.extend({layers: rows(layer), omittedLayers: n})), omittedManifests: n,
  tags: rows(z.object({tag: text, digest}).strict()), omittedTags: n}).strict();
const client = z.object({id: text, cachedBytes: n, pulledBytes: n, reusedLayers: n, failures: n, cache: rows(layer), omittedCache: n,
  replicas: rows(z.object({id: text, target: t, reference: t, state: z.enum(["pending", "pulling", "failed", "running"]).nullable().optional(),
    attempts: n, artifactReadyAtUs: n, resolvedDigest: d, requiredLayers: rows(layer), omittedLayers: n}).strict()), omittedReplicas: n, events, omittedEvents: n}).strict();
const controller = z.object({id: text, signal: z.object({source: z.literal("observed-core-time"), backend: text, freshForUs: count.min(1)}).strict().nullable().optional(), desired: n, inService: n, evaluations: n, missingMeasurements: n, identityBudgetExhausted: n,
  replicas: rows(z.object({id: text, ordinal: n, state: z.enum(["reserved", "provisioning", "pulling", "starting", "ready", "draining", "failed", "terminated"]).nullable().optional(),
    createdAtUs: n, listenerReadyAtUs: n, attempts: n, endpointAlive: b, endpointReady: b, lbHealthy: b, lbDraining: b}).strict()),
  omittedReplicas: n, events, omittedEvents: n}).strict();

/** Optional historical evidence stays incomplete; never repair or derive absent counters. */
export const StartupSchema = z.object({version: z.literal(1), sampledAtUs: n,
  registries: rows(registry), omittedRegistries: n, clients: rows(client), omittedClients: n, controllers: rows(controller), omittedControllers: n,
}).strict().superRefine((m, ctx) => {
  const refuse = () => ctx.addIssue({code: "custom", message: "Inconsistent startup ownership observations"});
  const unique = <T>(list: T[] | null | undefined, key: (row: T) => string) => { if (list && new Set(list.map(key)).size !== list.length) refuse(); };
  const bytes = (list: z.infer<typeof layer>[] | null | undefined, total: number | null | undefined, missing: number | null | undefined) => {
    if (!list || total == null) return;
    const sum = list.reduce((s, r) => s + r.bytes, 0);
    if (!Number.isSafeInteger(sum) || sum > total || missing === 0 && sum !== total) refuse();
  };
  const time = (at: number | null | undefined) => { if (at != null && m.sampledAtUs != null && at > m.sampledAtUs) refuse(); };
  unique(m.registries, r => r.id); unique(m.clients, r => r.id); unique(m.controllers, r => r.id);
  for (const r of m.registries ?? []) {
    unique(r.blobs, b => b.digest); unique(r.manifests, b => b.digest); unique(r.tags, t => t.tag);
    bytes(r.blobs, r.blobBytes, r.omittedBlobs);
    if (r.deduplicated != null && r.uploads != null && r.deduplicated > r.uploads) refuse();
  }
  for (const c of m.clients ?? []) {
    unique(c.cache, b => b.digest); unique(c.replicas, r => r.id); bytes(c.cache, c.cachedBytes, c.omittedCache);
    for (const r of c.replicas ?? []) time(r.artifactReadyAtUs);
    for (const e of c.events ?? []) time(e.at);
  }
  for (const c of m.controllers ?? []) {
    unique(c.replicas, r => r.id);
    for (const r of c.replicas ?? []) {
      time(r.createdAtUs); time(r.listenerReadyAtUs);
      if (r.listenerReadyAtUs != null && r.createdAtUs != null && r.listenerReadyAtUs < r.createdAtUs) refuse();
    }
    for (const e of c.events ?? []) time(e.at);
  }
});
