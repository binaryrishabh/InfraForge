import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const id = z.string().min(1).max(256);
export const MonitoringMetricsSchema = z.object({version: z.literal(1),
  generated: count, collections: count, collectionFailures: count, exported: count,
  dropped: count, droppedBeforeExport: count, discardedUnconfirmed: count,
  batches: count, failedBatches: count, bufferedSamples: count, bufferedBytes: count,
  inFlightSamples: count, inFlightBytes: count,
  freshness: z.array(z.object({target: id, measuredAt: count, ageUs: count,
    state: z.enum(["missing", "stale", "fresh"]).nullable()})).max(500).nullable(),
});
export const MonitoringBackendSchema = z.object({version: z.literal(1), id,
  received: count, duplicates: count, refused: count,
  latest: z.array(z.object({target: id, measurementAt: count, arrivedAt: count, ageUs: count})).max(500).nullable(),
});
