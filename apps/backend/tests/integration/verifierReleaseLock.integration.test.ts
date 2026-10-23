import { expect, test } from "bun:test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { acquireReleaseOwnership, assertNoWorker } from "../../release/migrations";
import { acquireVerifierOwnership } from "../../firstStack/verifierOwnership";

const url = process.env.INTEGRATION_RUN === "1" ? process.env.INTEGRATION_DATABASE_URL : undefined;
(url ? test : test.skip)("PostgreSQL excludes release and verifier in both startup orders", async () => {
  const target = new URL(url!);
  if (process.env.INTEGRATION_DISPOSABLE !== "local-only" ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    !/^\/infraforge_it_[a-f0-9]+$/.test(target.pathname) || target.search) {
    throw Error("Explicit disposable local integration database required");
  }
  const admin = new Client({ connectionString: target.href, connectionTimeoutMillis: 2000 });
  const name = `infraforge_it_${randomUUID().replaceAll("-", "")}`;
  let created = false, release: Client | undefined;
  let verifier: Awaited<ReturnType<typeof acquireVerifierOwnership>> | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    target.pathname = `/${name}`;
    const connect = async () => {
      const client = new Client({ connectionString: target.href, connectionTimeoutMillis: 2000, query_timeout: 2000 });
      await client.connect(); return client;
    };
    // Release-first: its own lifecycle lock is allowed, but every new verifier is refused.
    release = await connect();
    await acquireReleaseOwnership(release);
    await assertNoWorker(release);
    await expect(acquireVerifierOwnership(target.href, () => {})).rejects.toThrow("Another");
    const otherRelease = await connect();
    try { await expect(acquireReleaseOwnership(otherRelease)).rejects.toThrow("owns"); }
    finally { await otherRelease.end(); }
    // Excluding the release's own lock 12 must not hide its worker/executor locks.
    for (const lock of [1, 10]) {
      await release.query("SELECT pg_advisory_lock(186542854,$1)", [lock]);
      await expect(assertNoWorker(release)).rejects.toThrow("worker");
      await release.query("SELECT pg_advisory_unlock(186542854,$1)", [lock]);
    }
    await release.end(); release = undefined;
    // Verifier-first: release cannot pass acquisition or the existing observation check.
    verifier = await acquireVerifierOwnership(target.href, () => {});
    release = await connect();
    await expect(acquireReleaseOwnership(release)).rejects.toThrow("owns");
    await expect(assertNoWorker(release)).rejects.toThrow("worker");
    await verifier.close(); verifier = undefined;
    await acquireReleaseOwnership(release);
    await assertNoWorker(release);
  } finally {
    await verifier?.close(); await release?.end();
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  }
}, 30000);
