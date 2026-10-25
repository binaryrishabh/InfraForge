import { expect, test } from "bun:test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// The release postcheck runs this same `prisma migrate diff --exit-code`; checking it here
// catches migration/schema drift locally instead of only in the CI release rehearsal.
const url = process.env.INTEGRATION_RUN === "1" ? process.env.INTEGRATION_DATABASE_URL : undefined;
const backend = fileURLToPath(new URL("../..", import.meta.url));

function run(args: string[], databaseUrl: string) {
  return Bun.spawn([process.execPath, "--no-env-file", "--no-install", ...args], {
    cwd: backend, stdout: "ignore", stderr: "pipe",
    env: { PATH: process.env.PATH ?? "", ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      DATABASE_URL: databaseUrl },
  });
}

(url ? test : test.skip)("migrations produce exactly the Prisma schema, with no drift", async () => {
  const parsed = new URL(url!);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" ||
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !/^\/infraforge_it_[a-f0-9]+$/.test(parsed.pathname) || parsed.search) {
    throw Error("Explicit disposable local integration database required");
  }
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(url!);
  target.pathname = `/${name}`;
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  try {
    const migration = run(["run", "db:migrate"], target.href);
    const migrateError = await new Response(migration.stderr).text();
    if (await migration.exited !== 0) throw Error(`Disposable migration failed: ${migrateError.slice(-2000)}`);
    const diff = run(["run", "--bun", "prisma", "migrate", "diff", "--from-config-datasource",
      "--to-schema", "prisma/schema.prisma", "--config", "prisma.config.ts", "--exit-code"], target.href);
    const diffError = await new Response(diff.stderr).text();
    // Exit 0 means the migrated database matches the schema exactly; 2 means drift.
    expect({ exit: await diff.exited, detail: diffError.slice(-1000) }).toEqual({ exit: 0, detail: expect.any(String) });
  } finally {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}, 120000);
