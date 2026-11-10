import type { StartupMetrics, StartupClient, StartupRegistry, StartupController } from "@infraforge/contracts/telemetry";
import { requireKnown } from "../../reality/quantity";
import type { CompiledProduct } from "./contracts";
import type { createProductModel2 } from "./run";

type Source = Pick<ReturnType<typeof createProductModel2>, "inspectRegistry" | "inspectArtifactClient" | "inspectControllers">;
const retain = <T>(rows: readonly T[] | null | undefined) => rows == null ? null : rows.slice(0, 100);
const omitted = (rows: readonly unknown[] | null | undefined) => rows == null ? null : Math.max(0, rows.length - 100);

/** Observer projection only: no registry, startup, controller or routing decisions. */
export function startupLive(compiled: CompiledProduct, source: Source, node: string, owner: (id: string) => string | undefined, sampledAtUs: number): StartupMetrics | undefined {
  const registryIds = compiled.input.resources.filter(r => r.kind === "registry" && owner(r.id) === node).map(r => r.id);
  const clientIds = compiled.input.resources.filter(r => r.kind === "artifact-client" && owner(r.id) === node).map(r => r.id);
  const pools = compiled.pools.filter(p => owner(p.id) === node);
  if (!registryIds.length && !clientIds.length && !pools.length) return;
  const registries: StartupRegistry[] = registryIds.slice(0, 100).map(id => {
    const r = source.inspectRegistry(id), tags = r?.tags == null ? null : Object.entries(r.tags).map(([tag, digest]) => ({tag, digest}));
    return {id, uploads: r?.uploads ?? null, deduplicated: r?.deduplicated ?? null, manifestWrites: r?.manifestWrites ?? null,
      tagWrites: r?.tagWrites ?? null, manifestReads: r?.manifestReads ?? null, blobReads: r?.blobReads ?? null,
      generatedResponseBodyBytes: r?.generatedResponseBodyBytes ?? null, blobBytes: r?.blobBytes ?? null,
      blobs: retain(r?.blobs), omittedBlobs: omitted(r?.blobs),
      manifests: retain(r?.manifests)?.map(m => ({digest: m.digest, bytes: m.bytes, layers: retain(m.layers), omittedLayers: omitted(m.layers)})) ?? null,
      omittedManifests: omitted(r?.manifests), tags: retain(tags), omittedTags: omitted(tags)};
  });
  const clients: StartupClient[] = clientIds.slice(0, 100).map(id => {
    const c = source.inspectArtifactClient(id);
    return {id, cachedBytes: c?.cachedBytes ?? null, pulledBytes: c?.pulledBytes ?? null, reusedLayers: c?.reusedLayers ?? null, failures: c?.failures ?? null,
      cache: retain(c?.cache), omittedCache: omitted(c?.cache),
      replicas: retain(c?.replicas)?.map(r => ({id: r.id, target: r.target, reference: r.reference, state: r.state, attempts: r.attempts,
        artifactReadyAtUs: r.readyAt, resolvedDigest: r.resolvedDigest, requiredLayers: retain(r.requiredLayers), omittedLayers: omitted(r.requiredLayers)})) ?? null,
      omittedReplicas: omitted(c?.replicas), events: retain(c?.events.rows),
      omittedEvents: c?.events == null ? null : c.events.omitted + omitted(c.events.rows)!};
  });
  // Read controllers only for the owner that has one; never copy full run evidence per node.
  const rawControllers = pools.length ? source.inspectControllers() : [];
  const controllers: StartupController[] = pools.slice(0, 100).map(p => {
    const c = rawControllers.find(c => c.id === p.id);
    const signal = p.profile.signal, marked = compiled.semantic.versions.contract.includes("/autoscaling-observed/1") && signal.kind === "observed-core-time";
    return {id: p.id, ...(marked ? {signal: {source: signal.kind, backend: signal.backend, freshForUs: requireKnown(signal.freshFor, "us")}} : {}), desired: c?.desired ?? null, inService: c?.inService ?? null, evaluations: c?.evaluations ?? null,
      missingMeasurements: c?.missingMeasurements ?? null, identityBudgetExhausted: c?.identityBudgetExhausted ?? null,
      replicas: retain(c?.replicas)?.map(r => ({id: r.id, ordinal: r.ordinal, state: r.state, createdAtUs: r.createdAt, listenerReadyAtUs: r.readyAt,
        attempts: r.attempts, endpointAlive: r.endpoint.alive, endpointReady: r.endpoint.ready, lbHealthy: r.lb.health, lbDraining: r.lb.draining})) ?? null,
      omittedReplicas: omitted(c?.replicas), events: retain(c?.events), omittedEvents: c == null ? null : c.omitted + omitted(c.events)!};
  });
  return {version: 1, sampledAtUs, registries, omittedRegistries: omitted(registryIds), clients, omittedClients: omitted(clientIds), controllers, omittedControllers: omitted(pools)};
}
