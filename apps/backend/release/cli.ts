import { Client } from "pg";
import { assertNoWorker, checkHistory, checkSchemaGuards, migrationPreflight, migrationManifest, migrationFingerprint } from "./migrations";
import { AUTH_CONTRACT } from "./runtime";
import { verifyWorkerSession, workerDatabaseUrl } from "../infra/workerConnection";
import { verifyDatabaseTargets } from "./databaseTargets";

const command = process.argv[2];
if (command === "manifest") {
  const sha = process.argv[3];
  if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("A full release commit SHA is required");
  console.log(JSON.stringify({ sha, authContract: AUTH_CONTRACT, migrationFingerprint: migrationFingerprint(await migrationManifest()) }));
} else {
  if (!["preflight", "migrate", "postcheck"].includes(command ?? "")) throw new Error("Use manifest, preflight, migrate or postcheck");
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000 });
  const prisma = async (args: string[]) => {
    const child = Bun.spawn(["bun", "--no-env-file", "--no-install", "run", "--bun", "prisma", "migrate", ...args, "--config", "prisma.config.ts"],
      { stdout: "pipe", stderr: "pipe" });
    // Do not emit raw CLI output: connection details may be present.
    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (await child.exited !== 0) throw new Error(`Prisma 7.9.1 migrate ${args[0]} failed; inspect the database privately`);
  };
  try {
    if (process.env.NODE_ENV === "production") {
      const migrationUrl = workerDatabaseUrl({ ...process.env, WORKER_DATABASE_MODE: "direct" });
      if (!process.env.API_DATABASE_URL || !process.env.WORKER_DATABASE_URL) throw new Error("All database endpoints must be verified");
      await verifyWorkerSession(migrationUrl);
      await verifyDatabaseTargets(migrationUrl, [process.env.API_DATABASE_URL, process.env.WORKER_DATABASE_URL]);
    }
    await db.connect();
    await migrationPreflight(db);
    if (command !== "preflight") {
      await assertNoWorker(db);
      if (command === "migrate") await prisma(["deploy"]);
      await checkHistory(db);
      await checkSchemaGuards(db);
      await prisma(["status"]);
      await prisma(["diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"]);
    }
    console.log(JSON.stringify({ success: true, phase: command }));
  } catch {
    console.error(`Release ${command} failed. Application must stay stopped until migration/history/schema checks pass.`);
    process.exitCode = 1;
  } finally { await db.end(); }
}
