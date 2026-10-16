import { readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";
export async function checkInternalModel2Schema(db: Pick<Client | Pool, "query">) {
  const sql = await readFile(new URL("../prisma/migrations/20261019000000_internal_model2/migration.sql", import.meta.url), "utf8");
  const body = /CREATE FUNCTION protect_internal_model2\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/.exec(sql)?.[1];
  const triggers = await db.query(`SELECT t.tgtype,pg_get_triggerdef(t.oid) AS definition,p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."InternalModel2Run"'::regclass AND t.tgname='internal_model2_guard' AND NOT t.tgisinternal AND t.tgenabled='O'
      AND p.proname='protect_internal_model2' AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND t.tgqual IS NULL`);
  if (!body || triggers.rows.length !== 1 || triggers.rows[0].tgtype !== 31 || !triggers.rows[0].definition.includes('BEFORE INSERT OR DELETE OR UPDATE ON public."InternalModel2Run"') ||
      triggers.rows[0].prosrc.replaceAll("\r\n", "\n").trim() !== body.replaceAll("\r\n", "\n").trim()) throw Error("Internal Model-2 database guard differs from this release");
  const constraints = await db.query(`SELECT conname FROM pg_constraint WHERE conrelid='public."InternalModel2Run"'::regclass AND contype='c' AND convalidated`);
  const expected = ["internal_model2_state", "internal_model2_bytes", "internal_model2_identity", "internal_model2_evidence", "internal_model2_terminal", "internal_model2_complete"];
  if (constraints.rows.length !== expected.length || constraints.rows.some((r) => !expected.includes(r.conname))) throw Error("Internal Model-2 persistence constraints missing");
  await db.query('SELECT "userId",reason,"grantedAt" FROM "InternalModel2Grant" LIMIT 0');
}
