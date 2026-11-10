/** Educational per-artifact-client byte admission limit for later cold replicas. */
export interface ArtifactCachePolicy { version: 1; capacityBytes: number }
export const ARTIFACT_CACHE_MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const ARTIFACT_CACHE_HELP = "Bytes each later replica's artifact client can own. A required layer that cannot fit blocks startup; more CPU or a higher replica maximum does not enlarge this cache. Initial deployed replicas stay ready. Blank keeps the existing 1 MiB profile. This models admission, not image download speed or shared host storage.";
export function artifactCachePolicyError(type: string, value: unknown, autoscalingEnabled?: boolean): string | undefined {
  if (value === undefined) return;
  if (type !== "Virtual Machine" || autoscalingEnabled !== true) return "Artifact cache capacity requires an explicitly enabled Virtual Machine autoscaling policy.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Artifact cache policy requires version 1 and capacityBytes.";
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(k => !["version", "capacityBytes"].includes(k))) return "Artifact cache policy requires version 1 with only its own fields.";
  if (typeof p.capacityBytes !== "number" || !Number.isSafeInteger(p.capacityBytes) || p.capacityBytes < 1 || p.capacityBytes > ARTIFACT_CACHE_MAX_BYTES) return `Artifact cache capacity must be an integer from 1 to ${ARTIFACT_CACHE_MAX_BYTES} bytes.`;
}
