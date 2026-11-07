import type { ResourceMetrics } from "@infraforge/contracts/telemetry";
import type { CompiledProduct } from "./contracts";
import type { createProductModel2 } from "./run";

type Source = Pick<ReturnType<typeof createProductModel2>, "inspectMonitor" | "inspectObject">;
type Readings = Pick<ResourceMetrics, "monitoring" | "objectStorage">;

// Read the same resource-owned records used by official evidence, without counting retained history.
export function observabilityLive(resource: CompiledProduct["input"]["resources"][number], source: Source, sampledAtUs?: number): Readings {
  if (resource.kind === "monitor") {
    const row = source.inspectMonitor(resource.id);
    return { monitoring: { version: 1, generated: row?.generated ?? null, collections: row?.collections ?? null, collectionFailures: row?.collectionFailures ?? null,
      exported: row?.exported ?? null, dropped: row?.dropped ?? null, droppedBeforeExport: row?.droppedBeforeExport ?? null, discardedUnconfirmed: row?.discardedUnconfirmed ?? null,
      batches: row?.batches ?? null, failedBatches: row?.failedBatches ?? null, bufferedSamples: row?.buffered?.length ?? null, bufferedBytes: row?.bufferedBytes ?? null,
      inFlightSamples: row?.inFlight?.reduce((n, batch) => n + batch.rows.length, 0) ?? null, inFlightBytes: row?.inFlightBytes ?? null, freshness: row?.freshness ?? null } };
  }
  if (resource.kind === "object-store") {
    const row = source.inspectObject(resource.id);
    return { objectStorage: { version: 1, ...(sampledAtUs === undefined ? {} : { sampledAtUs }),
      puts: row?.puts ?? null, gets: row?.gets ?? null, heads: row?.heads ?? null, generation: row?.generation ?? null,
      objectCount: row?.objects?.length ?? null, overCapacity: row?.overCapacity ?? null, generatedResponseBodyBytes: row?.generatedResponseBodyBytes ?? null,
      commandReasons: row?.service?.reasons ? { ...row.service.reasons } : null,
      objects: row?.objects?.slice(0, 100).map(({ namespace, key, generation, bytes }) => ({ namespace, key, generation, bytes })) ?? null,
      omittedObjects: row?.objects ? Math.max(0, row.objects.length - 100) : null,
      storedBytes: row?.storedBytes ?? null, capacityBytes: row?.capacityBytes ?? null, committedPuts: row?.committedPuts ?? null,
      replacedObjects: row?.replacedObjects ?? null, removedObjects: row?.removedObjects ?? null, deletes: row?.deletes ?? null, "object-capacity": row?.service?.reasons?.["object-capacity"] ?? null } };
  }
  return {};
}
