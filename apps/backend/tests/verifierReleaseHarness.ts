// Exercise the real release CLI and lock functions in an isolated process, without Prisma or a database.
import { mock, spyOn } from "bun:test";
import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";

const scenario = process.argv[2];
assert.ok(["release-first", "verifier-first", "postcheck", "failure"].includes(scenario!));
const sessions = new Set<Client>();
let preflights = 0, processes = 0;
class Client extends EventEmitter {
  holds = false;
  async connect() { sessions.add(this); }
  async end() { this.holds = false; sessions.delete(this); }
  async query(sql: string, args?: number[]) {
    if (sql.includes("pg_try_advisory_lock")) {
      assert.deepEqual(args, [186542854, 12]);
      if (![...sessions].some(session => session !== this && session.holds)) this.holds = true;
      return { rows: [{ held: this.holds }] };
    }
    if (sql.includes("pg_locks")) {
      const excludesOwn = sql.includes("objid <> 12::oid OR pid <> pg_backend_pid()");
      return { rows: [{ held: [...sessions].some(session => session.holds && (!excludesOwn || session !== this)) }] };
    }
    throw Error(`Unexpected fixture query: ${sql}`);
  }
}
mock.module("pg", () => ({ Client, Pool: Client }));
const migrations = await import("../release/migrations");
const { acquireVerifierOwnership } = await import("../firstStack/verifierOwnership");
mock.module("../release/migrations", () => ({ ...migrations,
  migrationPreflight: async (db: Client) => {
    preflights++;
    assert.equal(db.holds, true, "Release must own the lifecycle lock before checking idle state");
  },
  checkHistory: async (db: Client) => { assert.equal(db.holds, true); },
  checkSchemaGuards: async (db: Client) => { assert.equal(db.holds, true); },
}));

const spawn = spyOn(Bun, "spawn").mockImplementation((() => {
  processes++;
  return { stdout: new ReadableStream({ start(controller) { controller.close(); } }),
    stderr: new ReadableStream({ start(controller) { controller.close(); } }),
    exited: (async () => {
      await assert.rejects(acquireVerifierOwnership("fixture", () => {}), /Another/,
        "Verifier startup must be excluded throughout each Prisma operation");
      return scenario === "failure" ? 1 : 0;
    })(),
  };
}) as any);
let verifier: Awaited<ReturnType<typeof acquireVerifierOwnership>> | undefined;
try {
  if (scenario === "verifier-first") verifier = await acquireVerifierOwnership("fixture", () => {});
  process.argv[2] = scenario === "postcheck" ? "postcheck" : "migrate";
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://fixture@127.0.0.1/fixture";
  await import("../release/cli");
  if (scenario === "verifier-first") {
    assert.equal(process.exitCode, 1);
    assert.equal(preflights, 0);
    assert.equal(processes, 0);
    assert.equal(verifier!.held, true);
  } else {
    assert.equal(process.exitCode ?? 0, scenario === "failure" ? 1 : 0);
    assert.equal(preflights, 1);
    assert.equal(processes, scenario === "postcheck" ? 2 : scenario === "failure" ? 1 : 3);
  }
  await verifier?.close(); verifier = undefined;
  // Both normal completion and failure must release the session lock.
  const next = await acquireVerifierOwnership("fixture", () => {});
  await next.close();
  assert.equal(sessions.size, 0);
  process.exitCode = 0;
} finally { spawn.mockRestore(); await verifier?.close(); }
console.log(`Release exclusion ${scenario} passed`);
