import { checkHistory, assertNoWorker } from "../release/migrations";
import { CutoverError, requirePostgres18, type Database } from "./database";

export const FENCE_ACK = "legacy-writers-stopped-and-credentials-rotated";
export const RETIREMENT_MESSAGE = "Retired by the operator before the authentication release. The legacy simulator was stopped; the final checkpoint is diagnostic only.";

export function retirementRequest(ids: unknown, acknowledgement: string | undefined, evidence: string | undefined) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((id) => typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new CutoverError("Supply a nonempty unique explicit list of deployment UUIDs");
  }
  if (acknowledgement !== FENCE_ACK) throw new CutoverError("Legacy writers must first be stopped and fenced; explicit acknowledgement is required");
  if (!evidence || !/^[a-zA-Z0-9_.:/-]{1,160}$/.test(evidence)) throw new CutoverError("A non-secret fencing evidence reference is required");
  return { ids: ids as string[], evidence };
}

export async function retireLegacyRuns(db: Database, request: ReturnType<typeof retirementRequest>) {
  await db.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query("SET LOCAL search_path = pg_catalog, public");
    await requirePostgres18(db);
    const history = await checkHistory(db, false);
    if (history.count !== 8) throw new CutoverError("Legacy retirement is valid only on the exact eight-migration baseline");
    await assertNoWorker(db);
    // Also exclude concurrent inserts/updates. Row locks alone cannot prevent
    // another deployment appearing between the active-set check and commit.
    await db.query('LOCK TABLE public."Infrastructure", public."Deployment", public."Outbox" IN SHARE ROW EXCLUSIVE MODE NOWAIT');
    const clients = await db.query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database()
      AND (backend_type='client backend' OR backend_type IS NULL) AND pid<>pg_backend_pid()`);
    if (clients.rows[0].count) throw new CutoverError("Other database clients remain; prove writer fencing before retirement");
    const outbox = await db.query(`SELECT count(*)::int AS count FROM public."Outbox" WHERE status IN ('pending','processing','running')`);
    if (outbox.rows[0].count) throw new CutoverError("Pending/running outbox work must be resolved before retirement");
    const rows = await db.query(`SELECT id,status,jsonb_typeof(timeline) AS "timelineType" FROM public."Deployment"
      WHERE id=ANY($1::text[]) OR status IN ('pending','running','live') ORDER BY id FOR UPDATE`, [request.ids]);
    const selected = rows.rows.filter((row) => request.ids.includes(row.id));
    if (selected.length !== request.ids.length || selected.some((row) => row.status !== "live" || row.timelineType !== "array")) {
      throw new CutoverError("Every requested deployment must exist, be exactly live, and have an array timeline");
    }
    if (rows.rows.some((row) => !request.ids.includes(row.id))) throw new CutoverError("Another active deployment exists outside the explicit retirement set");
    const changed = await db.query(`UPDATE public."Deployment" SET status='torn-down',"updatedAt"=CURRENT_TIMESTAMP,
      timeline=timeline||jsonb_build_array(jsonb_build_object('timestamp',CURRENT_TIMESTAMP,'event','Operator retirement',
        'message',$2::text,'evidence',$3::text)) WHERE id=ANY($1::text[]) AND status='live' RETURNING id`,
      [request.ids, RETIREMENT_MESSAGE, request.evidence]);
    if (changed.rowCount !== request.ids.length) throw new CutoverError("Retirement row count mismatch; all changes rolled back");
    await db.query("COMMIT");
    return { result: "PASS", retiredIds: changed.rows.map((row) => row.id).sort(), count: changed.rowCount };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
