import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { checkHistory, checkSchemaGuards } from "./migrations";

export const AUTH_CONTRACT = 1;
export type ReleaseMetadata = { sha: string; authContract: number; migrationFingerprint: string };

export function requireProductionEndpoints(env: Record<string, string | undefined>) {
  if (!env.DATABASE_URL || !env.REDIS_HOST || !env.REDIS_PORT) throw new Error("Production database and Redis endpoints must be explicit");
  const database = new URL(env.DATABASE_URL);
  const port = Number(env.REDIS_PORT);
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname || database.pathname.length < 2 ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Production database/Redis endpoints are invalid");
}

export async function releaseMetadata(): Promise<ReleaseMetadata> {
  if (process.env.NODE_ENV !== "production") return { sha: "development", authContract: AUTH_CONTRACT, migrationFingerprint: "development" };
  const metadata = JSON.parse(await readFile(new URL("../release.json", import.meta.url), "utf8")) as ReleaseMetadata;
  if (!/^[a-f0-9]{40}$/.test(metadata.sha) || metadata.sha !== process.env.RELEASE_SHA || metadata.authContract !== AUTH_CONTRACT) {
    throw new Error("Image release identity is missing or does not match RELEASE_SHA");
  }
  return metadata;
}

export async function assertRuntimeSchema() {
  if (process.env.NODE_ENV !== "production") return;
  requireProductionEndpoints(process.env);
  const metadata = await releaseMetadata();
  const db = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
  try {
    const history = await checkHistory(db);
    if (history.fingerprint !== metadata.migrationFingerprint) throw new Error("Image migration manifest mismatch");
    await checkSchemaGuards(db);
  } finally { await db.end(); }
}
