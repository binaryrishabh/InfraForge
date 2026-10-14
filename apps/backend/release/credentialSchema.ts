import type { Client, Pool } from "pg";

export async function checkCredentialSchema(db: Pick<Client | Pool, "query">) {
  const indexes = await db.query(`SELECT i.relname, x.indisunique, x.indisvalid,
      x.indnkeyatts, x.indpred IS NULL AS unconditional,
      pg_get_indexdef(x.indexrelid, 1, true) AS key
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
    WHERE x.indrelid='public."User"'::regclass
      AND i.relname IN ('User_username_key','User_email_casefold_key')`);
  const expected: Record<string, string> = { User_username_key: "username", User_email_casefold_key: "lower(email)" };
  if (indexes.rows.length !== 2 || indexes.rows.some((row) => !row.indisunique || !row.indisvalid ||
    !row.unconditional || row.indnkeyatts !== 1 || row.key !== expected[row.relname])) {
    throw new Error("Credential identity uniqueness differs from this release");
  }
  const format = await db.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid='public."User"'::regclass AND conname='User_username_format' AND contype='c' AND convalidated`);
  if (format.rows.length !== 1 || !format.rows[0].definition.includes("^[a-z][a-z0-9_]{2,29}$")) {
    throw new Error("Credential username constraint differs from this release");
  }
}
