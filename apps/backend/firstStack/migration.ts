import type { PoolClient } from "pg";
import type { RunReference } from "@infraforge/contracts/reports";
import { z } from "zod";
import { NotFoundError, ValidationError } from "../utils/errors";

export const migrationSourceSchema = z.object({ engine: z.literal("1"), store: z.literal("Deployment"), id: z.uuid() }).strict();
// A run reference is server-checked audit context, applied after browser
// verification. It never enters the input, compile lock or cut fingerprint.
export async function migrationSource(db: Pick<PoolClient, "query">, owner: string, source: z.infer<typeof migrationSourceSchema> | undefined,
  layout: any): Promise<RunReference | undefined> {
  if (!source) return undefined;
  const row = (await db.query('SELECT id,"infrastructureId" FROM "Deployment" WHERE id=$1 AND "ownerId"=$2', [source.id, owner])).rows[0];
  if (!row) throw new NotFoundError("Migration source run unavailable");
  const reviewed = layout.firstStack?.migration;
  if (!row.infrastructureId || reviewed?.kind !== "reviewed-copy" || reviewed.reviewedBy !== owner ||
    reviewed.fromInfrastructureId !== row.infrastructureId) throw new ValidationError("Run migration requires an owned source and its explicit reviewed design copy");
  return { engine: "1", store: "Deployment", id: row.id };
}
