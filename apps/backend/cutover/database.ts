import { createHash } from "node:crypto";
import { Client } from "pg";

export type Database = Pick<Client, "query">;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export class CutoverError extends Error {}

export function databaseUrl(value: string | undefined, direct = false) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new CutoverError("An explicit database URL is required"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || url.pathname.length < 2 || url.hash) {
    throw new CutoverError("Invalid database target");
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(url.hostname);
  if (!local && url.searchParams.get("sslmode") !== "verify-full") throw new CutoverError("Remote targets require sslmode=verify-full");
  const options = new Set<string>();
  for (const [key, option] of url.searchParams) {
    if (options.has(key)) throw new CutoverError("Duplicate database options make the target ambiguous");
    options.add(key);
    if (!(key === "sslmode" && (option === "verify-full" || local && option === "disable")) && !(key === "channel_binding" && option === "require")) {
      throw new CutoverError("Unsupported database options could redirect the target or weaken TLS");
    }
  }
  if (direct && (/-pooler\./i.test(url.hostname) || url.searchParams.get("pgbouncer") === "true" || url.searchParams.has("pool_mode"))) {
    throw new CutoverError("This operation requires a direct session-preserving endpoint");
  }
  return url;
}

export function connectDatabase(value: string, name: string) {
  const url = databaseUrl(value);
  return new Client({ connectionString: url.href, application_name: name, connectionTimeoutMillis: 10000, query_timeout: 30000 });
}

export async function readOnly<T>(db: Database, read: () => Promise<T>): Promise<T> {
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await db.query("SET LOCAL statement_timeout = '30s'");
    await db.query("SET LOCAL search_path = pg_catalog, public");
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    await db.query("SET LOCAL DateStyle = 'ISO, YMD'");
    const result = await read();
    await db.query("COMMIT");
    return result;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}

export async function requirePostgres18(db: Database) {
  const result = await db.query("SELECT current_setting('server_version_num')::int AS version");
  if (Math.floor(result.rows[0].version / 10000) !== 18) throw new CutoverError("Cutover proof requires PostgreSQL major 18");
}

export function safeFailure(error: unknown) {
  return error instanceof CutoverError ? error.message : "Database/tool operation failed; inspect privately without publishing raw diagnostics";
}
