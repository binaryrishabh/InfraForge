import { artifactCachePolicyError, type Resource } from "@infraforge/domain/resource";
import { requireKnown, type Quantity } from "../../reality/quantity";
import type { CompiledPool, ProductContract } from "./contracts";
import type { SystemsInput } from "../systems/contracts";

export const ARTIFACT_CACHE_PROFILE = "artifact-cache/1" as const;
export const changedArtifactCache = (r: Resource) => r.artifactCachePolicy !== undefined;
export const artifactCacheChanges = (resources: readonly Resource[]) => resources.some(changedArtifactCache);
export function artifactCacheCapacity(r: Resource, q: (id: string, value: number, unit: "bytes", sentence?: string, authored?: boolean) => Quantity<"bytes">) {
  return r.artifactCachePolicy === undefined ? q(`${r.id}.image.cache`, 1048576, "bytes") :
    q(`${r.id}.image.cache`, r.artifactCachePolicy.capacityBytes, "bytes", "Saved per-client artifact byte admission limit for later cold replicas; no pull speed or shared host cache claim.", true);
}
export function validateArtifactCacheProfile(resources: readonly Resource[], contract: ProductContract) {
  const count = (version: string) => {
    const profiles = version.match(/\/artifact-cache\/[^/]+/g) ?? [];
    if (profiles.some(p => p !== `/${ARTIFACT_CACHE_PROFILE}`)) throw Error("Unsupported artifact cache profile");
    return profiles.length;
  };
  if (count(contract.version) !== Number(artifactCacheChanges(resources))) throw Error("Artifact cache requires its explicit artifact-cache/1 contract version and matching saved intent");
  for (const r of resources) {
    if (count(contract.nodes[r.id]?.profileVersion ?? "") !== Number(changedArtifactCache(r))) throw Error("Artifact cache requires its owned profile and matching saved intent");
    const message = artifactCachePolicyError(r.type, r.artifactCachePolicy, r.autoscaling?.enabled);
    if (message) throw Error(message);
    if (!changedArtifactCache(r)) continue;
    const node = contract.nodes[r.id]!, artifact = node.controller?.artifact;
    if (!artifact || artifact.node !== r.id || artifact.role !== "image" || node.resources.filter(r => r.config.kind === "artifact-client").length !== 1) throw Error("Artifact cache requires a single owned image client per replica");
  }
}
/** Validate every expanded owner, even reserved/initial slots; never share a client's bytes. */
export function validateArtifactCacheBindings(resources: readonly Resource[], input: SystemsInput, pools: readonly CompiledPool[]) {
  for (const r of resources.filter(changedArtifactCache)) {
    const pool = pools.find(p => p.id === r.id), expected = pool?.replicas;
    if (!pool || !expected?.length || expected.length !== r.autoscaling?.maxReplicas || pool.artifactClients.length !== expected.length) throw Error("Artifact cache requires its owned replica pool");
    for (const replica of expected) {
      const id = `${replica}/image`, bindings = pool.artifactClients.filter(a => a.replica === replica), clients = input.resources.filter(c => c.id === id), client = clients[0];
      if (bindings.length !== 1 || bindings[0]!.id !== id || clients.length !== 1 || client?.kind !== "artifact-client" ||
        requireKnown(client.cacheBytes, "bytes") !== r.artifactCachePolicy!.capacityBytes || client.replicas.length !== 1 ||
        client.replicas[0]!.id !== replica || client.replicas[0]!.target !== replica) throw Error("Artifact cache capacity and unique client ownership must match saved intent on every replica");
    }
  }
}
