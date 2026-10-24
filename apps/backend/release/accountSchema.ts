import { readFile } from "node:fs/promises";
import type { Client, Pool } from "pg";

export async function checkAccountSchema(db: Pick<Client | Pool, "query">) {
  const source = await readFile(new URL("../prisma/migrations/20261023000000_account_essentials/migration.sql", import.meta.url), "utf8");
  const bodies = new Map([...source.matchAll(/CREATE FUNCTION (\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$/g)]
    .map(m => [m[1], m[2]!.replaceAll("\r\n", "\n").trim()]));
  const expected = [
    ["session_live_account", "Session", "require_live_account", 23],
    ["credential_live_account", "Account", "require_live_account", 23],
    ["design_live_account", "Infrastructure", "require_live_account", 23],
    ["deployment_live_account", "Deployment", "require_live_account", 23],
    ["model2_live_account", "InternalModel2Run", "require_live_account", 7],
    ["first_stack_live_account", "FirstStackRun", "require_live_account", 7],
    ["deleted_account_guard", "User", "protect_deleted_account", 19],
  ] as const;
  const rows = await db.query(`SELECT t.tgname,t.tgtype,c.relname,p.proname,p.prosrc,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
    WHERE t.tgname=ANY($1) AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgqual IS NULL
      AND c.relnamespace='public'::regnamespace AND p.pronamespace='public'::regnamespace
      AND NOT p.prosecdef AND p.proconfig IS NULL AND p.prorettype='trigger'::regtype
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')`, [expected.map(r => r[0])]);
  if (rows.rowCount !== expected.length) throw Error("Account persistence guards missing");
  for (const row of rows.rows) {
    const guard = expected.find(r => r[0] === row.tgname);
    const column = row.relname === "Session" || row.relname === "Account" ? "userId" : "ownerId";
    if (!guard || row.relname !== guard[1] || row.proname !== guard[2] || row.tgtype !== guard[3] ||
      guard[3] === 23 && !row.definition.includes(`BEFORE INSERT OR UPDATE OF "${column}" ON`) ||
      row.prosrc.replaceAll("\r\n", "\n").trim() !== bodies.get(row.proname)) throw Error("Account persistence guard differs from release");
  }
  const constraint = await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='public."User"'::regclass AND conname='User_deleted_profile' AND contype='c' AND convalidated`);
  if (constraint.rowCount !== 1 || !["deletedAt", "Deleted account", "deleted[.]invalid", "username IS NULL", "image IS NULL"].every(s => constraint.rows[0].definition.includes(s))) throw Error("Deleted profile constraint missing");
  await db.query('SELECT u."deletedAt",t.hash,t."userId",t."expiresAt",t."usedAt" FROM "User" u CROSS JOIN "AccountEmailToken" t LIMIT 0');
  await db.query('SELECT id,"userId",payload,status,attempts,"retrySafe","availableAt","expiresAt" FROM "AccountMailOutbox" LIMIT 0');
  await db.query('SELECT id,kind,"userId",payload,status,attempts,"retrySafe","availableAt","expiresAt" FROM "AccountMailIntent" LIMIT 0');
}
