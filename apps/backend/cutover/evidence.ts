import { createHash } from "node:crypto";
import { digest, readOnly, requirePostgres18, type Database } from "./database";
import { schemaCatalog, catalogDifferences, type Catalog } from "./catalog";

const domainTables = ["Infrastructure", "Deployment", "Outbox"];
const authTables = ["User", "Session", "Account", "Verification"];
const pendingObjects = ["relation:User", "relation:Session", "relation:Account", "relation:Verification",
  "column:Infrastructure.ownerId", "column:Deployment.runInputs", "column:Deployment.liveTopology",
  "column:Deployment.topologyRevision", "column:Deployment.runtimeActive", "index:Infrastructure_ownerId_idx",
  "function:protect_deployment_inputs()", "function:protect_active_deployment()", "function:protect_design_owner()",
  "trigger:Deployment.deployment_inputs_immutable", "trigger:Deployment.deployment_active_delete_guard", "trigger:Infrastructure.design_owner_guard"];
const marker = (value: string | null) => value === null ? null : value === "test-user" ? value : `sha256:${digest(value)}`;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value;
const checkpointTime = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) ? value : null;

export async function collectEvidence(db: Database) {
  return readOnly(db, async () => {
    await requirePostgres18(db);
    const identity = (await db.query(`SELECT version() AS version,current_setting('server_version_num')::int AS "versionNumber",
      current_database() AS database,current_user AS role,pg_backend_pid() AS pid,
      (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS "databaseOid"`)).rows[0];
    const catalog = await schemaCatalog(db);
    const tables = Object.fromEntries([...domainTables, ...authTables, "_prisma_migrations"].map((name) => [name, !!catalog[`relation:${name}`]]));
    const history = tables._prisma_migrations ? (await db.query(`SELECT migration_name,checksum,started_at,finished_at,
      rolled_back_at,applied_steps_count FROM public."_prisma_migrations" ORDER BY migration_name,started_at`)).rows : [];
    const counts: Record<string, number> = {};
    const contentHashes: Record<string, string> = {};
    for (const name of [...domainTables, ...authTables]) {
      if (!tables[name]) continue;
      counts[name] = (await db.query(`SELECT count(*)::int AS count FROM public."${name}"`)).rows[0].count;
      // Only application tables are hashed. Auth rows (including session/OAuth
      // tokens and verification values) are never selected or hashed.
      if (domainTables.includes(name)) {
        const hash = createHash("sha256");
        const rows = await db.query(`SELECT id,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash
          FROM public."${name}" t ORDER BY id COLLATE "C"`);
        for (const row of rows.rows) hash.update(`${row.id}\0${row.hash}\n`);
        contentHashes[name] = hash.digest("hex");
      }
    }
    const historical = tables.Infrastructure ? (await db.query(`SELECT "userId",count(*)::int AS count
      FROM public."Infrastructure" GROUP BY "userId" ORDER BY "userId" COLLATE "C"`)).rows
      .map((row) => ({ marker: marker(row.userId), count: row.count })) : [];
    const owners = catalog["column:Infrastructure.ownerId"] ? (await db.query(`SELECT "ownerId",count(*)::int AS count
      FROM public."Infrastructure" GROUP BY "ownerId" ORDER BY "ownerId" COLLATE "C" NULLS FIRST`)).rows
      .map((row) => ({ owner: marker(row.ownerId), count: row.count })) : null;
    const statusCounts = async (table: string) => tables[table] ? (await db.query(`SELECT status,count(*)::int AS count
      FROM public."${table}" GROUP BY status ORDER BY status COLLATE "C"`)).rows : [];
    const safeStatus = (row: { status: string; count: number }) => ({ ...row, status: ["pending", "running", "processing", "live", "completed", "failed", "torn-down"].includes(row.status) ? row.status : `sha256:${digest(row.status)}` });
    const deployments = (await statusCounts("Deployment")).map(safeStatus);
    const outbox = (await statusCounts("Outbox")).map(safeStatus);
    const active = tables.Deployment ? (await db.query(`SELECT id,status,"createdAt","updatedAt",
      "simulationState"->>'simulatedSeconds' AS "simulatedSeconds",
      "simulationState"->>'timestamp' AS "checkpointTimestamp",
      (to_jsonb(d)->>'runtimeActive')::boolean AS "runtimeActive"
      FROM public."Deployment" d WHERE status IN ('pending','running','live')
      OR (to_jsonb(d)->>'runtimeActive')::boolean IS TRUE ORDER BY id COLLATE "C"`)).rows.map((row) => ({ ...row,
        simulatedSeconds: /^\d+(\.\d+)?$/.test(row.simulatedSeconds ?? "") ? row.simulatedSeconds : null,
        checkpointTimestamp: checkpointTime(row.checkpointTimestamp),
      })) : [];
    const sessions = (await db.query(`SELECT pid,usename,application_name,state,backend_type,backend_start,xact_start,
      query_start,wait_event_type,wait_event,client_addr::text AS peer FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() ORDER BY pid`)).rows.map((row) => ({
        pid: row.pid, roleFingerprint: digest(row.usename ?? ""), peerFingerprint: row.peer ? digest(row.peer) : null,
        application: /^infraforge-[a-z-]+$/.test(row.application_name) ? row.application_name : "[other]",
        state: row.state, backendType: row.backend_type, backendStart: iso(row.backend_start), transactionStart: iso(row.xact_start),
        queryStart: iso(row.query_start), waitType: row.wait_event_type, wait: row.wait_event,
      }));
    const locks = (await db.query(`SELECT pid,classid::text,objid::text,objsubid,mode,granted
      FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      ORDER BY classid,objid,pid`)).rows;
    const applied = history.filter((row) => row.finished_at && !row.rolled_back_at).length;
    const belongsToNine = (key: string) => key.startsWith("column:Deployment.") || key.startsWith("trigger:Deployment.") ||
      ["function:protect_deployment_inputs()", "function:protect_active_deployment()"].includes(key);
    return { format: 1, capturedAt: new Date().toISOString(), identity: { version: identity.version,
      versionNumber: identity.versionNumber, database: identity.database, databaseOid: identity.databaseOid,
      roleFingerprint: digest(identity.role) }, history, tables, counts, contentHashes, historicalOwners: historical,
      verifiedOwners: owners, deployments, activeDeployments: active, outbox,
      pendingOutbox: outbox.filter((row) => ["pending", "running", "processing"].includes(row.status)).reduce((sum, row) => sum + row.count, 0),
      requiredColumns: Object.fromEntries(pendingObjects.filter((key) => key.startsWith("column:")).map((key) => [key.slice(7), !!catalog[key]])),
      pendingNameCollisions: applied < 10 ? pendingObjects.filter((key) => (applied < 9 || !belongsToNine(key)) && !!catalog[key]) : [], catalog, sessions, advisoryLocks: locks };
  });
}

export type Evidence = Awaited<ReturnType<typeof collectEvidence>>;
export function compareRestored(source: Evidence, restored: Evidence) {
  const differences: Array<{ object: string; change: string }> = catalogDifferences(source.catalog, restored.catalog);
  for (const key of ["history", "tables", "counts", "contentHashes", "historicalOwners", "verifiedOwners", "deployments", "activeDeployments", "outbox", "pendingOutbox"] as const) {
    if (JSON.stringify(source[key]) !== JSON.stringify(restored[key])) differences.push({ object: key, change: "restored evidence differs" });
  }
  return { result: differences.length ? "FAIL" : "PASS", differences };
}

export function compareSchema(expected: Catalog, actual: Catalog) {
  const differences = catalogDifferences(expected, actual);
  return { result: differences.length ? "FAIL" : "PASS", differences };
}
