import { canonical } from "../../model2/product/provenance";
import type { ProviderSnapshot } from "./contracts";
export interface ContentHasher {
  algorithm: "sha256-utf8/1";

  hash(text: string): string
}
export function digest(value: unknown, hasher: ContentHasher) {
  if (!hasher || hasher.algorithm !== "sha256-utf8/1" || typeof hasher.hash !== "function") throw Error("Explicit supported host SHA-256 implementation required");

  const result = hasher.hash(JSON.stringify(canonical(value)));

  if (!/^[0-9a-f]{64}$/.test(result)) throw Error("Invalid host content hash result");

  return result;
}
export function normalizedSnapshot(snapshot: ProviderSnapshot): ProviderSnapshot {
  const s = canonical(snapshot);

  for (const rows of [s.sources, s.locations, s.instances, s.prices]) rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  return s;
}
export const snapshotFingerprint = (snapshot: ProviderSnapshot, hasher: ContentHasher) => digest(normalizedSnapshot(snapshot), hasher);
