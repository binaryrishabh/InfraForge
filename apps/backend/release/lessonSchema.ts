import { readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";
export async function checkLessonSchema(db: Pick<Client | Pool, "query">) {
  const source = await readFile(new URL("../prisma/migrations/20261020000000_model2_lesson/migration.sql", import.meta.url), "utf8");
  const bodies = new Map([...source.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/g)].map((m) => [m[1], m[2]!.replaceAll("\r\n", "\n").trim()]));
  const rows = await db.query(`SELECT t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred,p.proname,p.prosrc,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgname IN ('model2_lesson_guard','model2_lesson_admission') AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgqual IS NULL
      AND p.pronamespace='public'::regnamespace AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')`);
  if (rows.rowCount !== 2) throw Error("Lesson persistence guards missing");
  for (const row of rows.rows) {
    const admission = row.tgname === "model2_lesson_admission";
    if (row.proname !== (admission ? "require_model2_lesson" : "protect_model2_lesson") || row.tgtype !== (admission ? 5 : 31) ||
      row.tgdeferrable !== admission || row.tginitdeferred !== admission || !row.definition.includes(admission ? 'AFTER INSERT ON public."InternalModel2Run"' : 'ON public."InternalModel2LessonRun"') ||
      row.prosrc.replaceAll("\r\n", "\n").trim() !== bodies.get(row.proname)) throw Error("Lesson database guard differs from this release");
  }
  const constraints = await db.query(`SELECT conname FROM pg_constraint WHERE convalidated AND contype='c' AND
    ((conrelid='public."InternalModel2LessonRun"'::regclass AND conname IN ('model2_lesson_policy','model2_lesson_receipt')) OR
     (conrelid='public."InternalModel2Grant"'::regclass AND conname='internal_model2_grant_scope'))`);
  if (constraints.rowCount !== 3) throw Error("Lesson persistence limits missing");
  await db.query('SELECT scope FROM "InternalModel2Grant" LIMIT 0');
}
