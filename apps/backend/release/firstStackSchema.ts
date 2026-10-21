import { readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";

export async function checkFirstStackSchema(db: Pick<Client | Pool, "query">) {
  const source = await readFile(new URL("../prisma/migrations/20261021000000_first_stack_submissions/migration.sql", import.meta.url), "utf8");
  const bodies = new Map([...source.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/g)]
    .map(m => [m[1], m[2]!.replaceAll("\r\n", "\n").trim()]));
  const expected = [
    ["first_stack_run_immutable", "FirstStackRun", "immutable_first_stack", 27],
    ["first_stack_cut_immutable", "FirstStackCut", "immutable_first_stack", 27],
    ["first_stack_result_immutable", "FirstStackResult", "immutable_first_stack", 27],
    ["first_stack_work_guard", "FirstStackWork", "protect_first_stack_work", 27],
    ["first_stack_cut_capture", "FirstStackCut", "capture_first_stack_evidence", 7],
    ["first_stack_result_capture", "FirstStackResult", "capture_first_stack_evidence", 7],
    ["first_stack_admission", "FirstStackRun", "require_first_stack_reservation", 5],
  ] as const;
  const triggers = await db.query(`SELECT t.tgname,t.tgtype,t.tgdeferrable,t.tginitdeferred,c.relname,p.proname,p.prosrc
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
    WHERE t.tgname=ANY($1) AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgqual IS NULL
      AND c.relnamespace='public'::regnamespace AND p.pronamespace='public'::regnamespace
      AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')`, [expected.map(r => r[0])]);
  if (triggers.rowCount !== expected.length) throw Error("First-stack persistence guards missing");
  for (const row of triggers.rows) {
    const guard = expected.find(r => r[0] === row.tgname), deferred = row.tgname === "first_stack_admission";
    if (!guard || row.relname !== guard[1] || row.proname !== guard[2] || row.tgtype !== guard[3] ||
      row.tgdeferrable !== deferred || row.tginitdeferred !== deferred || row.prosrc.replaceAll("\r\n", "\n").trim() !== bodies.get(row.proname)) throw Error("First-stack persistence guard differs from release");
  }
  const constraints = await db.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('public."FirstStackRun"'::regclass,'public."FirstStackWork"'::regclass,'public."FirstStackCut"'::regclass,'public."FirstStackResult"'::regclass)
      AND contype='c' AND convalidated`);
  const limits: Record<string, string[]> = { first_stack_input: ["16777216", "33554432", "300000000", "infraforge-first-stack-compile-lock/2", "IS TRUE"],
    first_stack_work: ["33554432", "recovery", "terminal"], first_stack_cut: ["4096", "2097152", "300000000", "IS TRUE"],
    first_stack_result: ["33554432", "unverified", "verified", "IS TRUE"] };
  if (constraints.rowCount !== 4 || constraints.rows.some(r => !limits[r.conname]?.every(fragment => r.definition.includes(fragment)))) throw Error("First-stack persistence limits differ from release");
  await db.query(`SELECT r.input,r.lock,r.engine,r.seed,r.workload,r.envelope,r.lineage,r."browserCut",r."reservedBytes",w.token,w.authorized,w."cancelRequested",w."captureBytes",s.hash,o.delivered
    FROM "FirstStackRun" r CROSS JOIN "FirstStackWork" w CROSS JOIN "FirstStackResult" s CROSS JOIN "FirstStackOutbox" o LIMIT 0`);
}
