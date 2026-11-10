/** Optional resource-owned observations. Times are simulation microseconds from run start.
 * Artifact readiness is acquisition only; listener readiness does not prove LB eligibility.
 * No replica generation or first LB-eligible timestamp exists in the source evidence. */
export interface StartupLayer { digest: string; bytes: number }
export interface StartupEvent { at: number; kind: string; id: string; detail: string }
export interface StartupRegistry {
  id: string;
  uploads?: number | null; deduplicated?: number | null; manifestWrites?: number | null; tagWrites?: number | null;
  manifestReads?: number | null; blobReads?: number | null; generatedResponseBodyBytes?: number | null; blobBytes?: number | null;
  blobs?: StartupLayer[] | null; omittedBlobs?: number | null;
  manifests?: Array<StartupLayer & { layers?: StartupLayer[] | null; omittedLayers?: number | null }> | null;
  omittedManifests?: number | null;
  tags?: Array<{ tag: string; digest: string }> | null; omittedTags?: number | null;
}
export interface StartupClient {
  id: string;
  /** Present only for saved artifact-cache/1 intent; absence stays Unknown. */
  capacityBytes?: number | null;
  cachedBytes?: number | null; pulledBytes?: number | null; reusedLayers?: number | null; failures?: number | null;
  cache?: StartupLayer[] | null; omittedCache?: number | null;
  replicas?: Array<{ id: string; target?: string | null; reference?: string | null; state?: "pending" | "pulling" | "failed" | "running" | null; attempts?: number | null;
    artifactReadyAtUs?: number | null; resolvedDigest?: string | null; requiredLayers?: StartupLayer[] | null; omittedLayers?: number | null }> | null;
  omittedReplicas?: number | null; events?: StartupEvent[] | null; omittedEvents?: number | null;
}
export interface StartupController {
  id: string;
  desired?: number | null; inService?: number | null; evaluations?: number | null; missingMeasurements?: number | null; identityBudgetExhausted?: number | null;
  replicas?: Array<{ id: string; ordinal?: number | null; state?: "reserved" | "provisioning" | "pulling" | "starting" | "ready" | "draining" | "failed" | "terminated" | null; createdAtUs?: number | null; listenerReadyAtUs?: number | null;
    attempts?: number | null; endpointAlive?: boolean | null; endpointReady?: boolean | null; lbHealthy?: boolean | null; lbDraining?: boolean | null }> | null;
  omittedReplicas?: number | null; events?: StartupEvent[] | null; omittedEvents?: number | null;
}
export interface StartupMetrics {
  version: 1;
  sampledAtUs?: number | null;
  /** At most 100 entries in each retained list; each omission count is explicit. */
  registries?: StartupRegistry[] | null; omittedRegistries?: number | null;
  clients?: StartupClient[] | null; omittedClients?: number | null;
  controllers?: StartupController[] | null; omittedControllers?: number | null;
}
