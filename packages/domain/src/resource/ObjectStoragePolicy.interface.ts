/** Optional educational byte ownership limit; omission preserves the resource profile. */
export interface ObjectStoragePolicy { version: 1; capacityMiB: number }
// The object engine accepts safe integer bytes. Largest whole MiB below that bound.
export const OBJECT_STORAGE_CAPACITY_MAX_MIB = 8589934591;
export const OBJECT_STORAGE_CAPACITY_HELP = "Maximum modeled bytes this object store can own. New or larger writes are refused when they would exceed this limit. This is an educational modeled limit, not provider storage capacity. Blank keeps the existing resource profile.";
export function objectStoragePolicyError(type: string, value: unknown): string | undefined {
  if (value === undefined) return;
  if (type !== "Object Storage") return "Object storage policy belongs to Object Storage.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Object storage policy requires version 1 and capacityMiB.";
  const p = value as Record<string, unknown>;
  if (p.version !== 1 || Object.keys(p).some(k => !["version", "capacityMiB"].includes(k))) return "Object storage policy requires version 1 with only its own fields.";
  if (typeof p.capacityMiB !== "number" || !Number.isSafeInteger(p.capacityMiB) || p.capacityMiB < 1 || p.capacityMiB > OBJECT_STORAGE_CAPACITY_MAX_MIB) return `Stored data capacity must be an integer from 1 to ${OBJECT_STORAGE_CAPACITY_MAX_MIB} MiB.`;
}
