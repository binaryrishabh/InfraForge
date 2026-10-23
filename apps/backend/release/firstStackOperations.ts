import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { closeSubmissionRecovery } from "../firstStack/admission";
import { closeHistoricalReplayRecovery } from "../firstStack/historicalReplay";
import { submissionStorage } from "../firstStack/submissionStorage";
import { workerDatabaseUrl } from "../infra/workerConnection";

// Installed host workspace only; credentials stay in systemd's protected file.
// This command never contacts Docker, launches work or prints immutable inputs.
export async function firstStackOperations(args: string[], pool: Pool) {
  if (args.length === 1 && args[0] === "inspect") {
    const reservations = await pool.query(`SELECT w."runId" AS id,w.status,w.token,w.daemon,r.engine->>'image' AS image,
      (SELECT body->>'fingerprint' FROM "FirstStackCut" WHERE "runId"=r.id ORDER BY sequence DESC LIMIT 1) AS prefix
      FROM "FirstStackWork" w JOIN "FirstStackRun" r ON r.id=w."runId" WHERE w.status<>'terminal' ORDER BY r."createdAt"`);
    const replays = await pool.query('SELECT id,status,daemon,fingerprint FROM "FirstStackReplay" WHERE status<>\'terminal\' ORDER BY "createdAt"');
    return { storage: await submissionStorage(pool), reservations: reservations.rows, replays: replays.rows };
  }
  const [operation, id, path] = args;
  if (args.length !== 3 || !["close-submission", "close-replay"].includes(operation!)) throw Error("Use inspect | close-submission UUID REVIEW.json | close-replay UUID REVIEW.json");
  z.uuid().parse(id);
  const text = await readFile(path!, "utf8");
  if (Buffer.byteLength(text) > 4096) throw Error("Recovery review exceeds 4096 bytes");
  const review = JSON.parse(text);
  if (operation === "close-submission") await closeSubmissionRecovery(pool, id!, review);
  else await closeHistoricalReplayRecovery(pool, id!, review);
  return { closed: id, verification: "interrupted" };
}

if (import.meta.main) {
  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (!directory) throw Error("Protected systemd database credential required");
  const url = (await readFile(join(directory, "database-url"), "utf8")).trim();
  const pool = new Pool({ connectionString: workerDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url, WORKER_DATABASE_MODE: "direct" }),
    max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000, statement_timeout: 5000, lock_timeout: 1000 });
  try { console.info(JSON.stringify(await firstStackOperations(process.argv.slice(2), pool))); }
  catch { console.error("First-stack operation refused; check stopped ownership, captured identity and review fields"); process.exitCode = 1; }
  finally { await pool.end(); }
}
