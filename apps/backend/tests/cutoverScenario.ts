import type { Database } from "../cutover/database";

export const legacyDesignId = "00000000-0000-4000-8000-000000000001";

// Production-shaped counts with wholly synthetic contents, never copied data.
export async function seedLegacyFixture(db: Database) {
  await db.query(`INSERT INTO "Infrastructure" (id,name,layout,"userId","createdAt","updatedAt")
    SELECT CASE WHEN i=1 THEN $1 ELSE gen_random_uuid()::text END,'Fixture design',
      '{"resources":[],"connectionLines":[]}'::jsonb,'test-user','2026-10-01','2026-10-01' FROM generate_series(1,28) i`, [legacyDesignId]);
  await db.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,seed,"resourceCount","workloadProfile",
    stages,timeline,"chaosEvents","simulationState","createdAt","updatedAt")
    SELECT gen_random_uuid()::text,$1,
      CASE WHEN i<=223 THEN 'completed' WHEN i<=231 THEN 'failed' WHEN i<=235 THEN 'live' ELSE 'torn-down' END,
      'preserved-seed',3,'{"requestsPerSecond":42}'::jsonb,'[{"event":"old stage"}]'::jsonb,
      '[{"event":"old timeline"}]'::jsonb,'[{"type":"old chaos"}]'::jsonb,
      jsonb_build_object('simulatedSeconds',i*60,'timestamp','2026-10-01T00:00:00Z'),'2026-10-01','2026-10-01'
    FROM generate_series(1,331) i`, [legacyDesignId]);
  await db.query(`INSERT INTO "Outbox" (id,"eventType",payload,status,"createdAt","processedAt")
    SELECT gen_random_uuid()::text,'DEPLOYMENT_CREATED',jsonb_build_object('fixture',i),
      'completed','2026-10-01','2026-10-01' FROM generate_series(1,348) i`);
  return (await db.query(`SELECT id FROM "Deployment" WHERE status='live' ORDER BY id`)).rows.map((row) => row.id as string);
}
