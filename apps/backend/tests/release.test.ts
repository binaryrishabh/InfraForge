import { expect, test } from "bun:test";
import { inspectHistory, migrationManifest, migrationFingerprint } from "../release/migrations";
import { workerDatabaseUrl } from "../infra/workerConnection";
import { requireProductionEndpoints } from "../release/runtime";

test("release accepts only an unchanged ordered migration prefix", async () => {
  const manifest = await migrationManifest();
  expect(manifest).toHaveLength(10);
  const rows = manifest.map((item) => ({ migration_name: item.name, checksum: item.checksum, finished_at: "done", rolled_back_at: null }));
  expect(inspectHistory(manifest, rows)).toBe(10);
  expect(inspectHistory(manifest, rows.slice(0, 8))).toBe(8);
  for (const invalid of [rows.slice(1), [...rows, rows[0]!], [{ ...rows[0]!, checksum: "edited" }],
    [{ ...rows[0]!, finished_at: null }], [{ ...rows[0]!, migration_name: "future" }]]) {
    expect(() => inspectHistory(manifest, invalid)).toThrow();
  }
  expect(migrationFingerprint(manifest)).toHaveLength(64);
});

test("production worker requires an explicitly supported connection mode", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://worker@localhost/infraforge" };
  expect(() => workerDatabaseUrl(base)).toThrow("WORKER_DATABASE_MODE");
  expect(workerDatabaseUrl({ ...base, WORKER_DATABASE_MODE: "direct" })).toBe(base.DATABASE_URL);
  expect(workerDatabaseUrl({ ...base, WORKER_DATABASE_MODE: "session" })).toBe(base.DATABASE_URL);
  for (const DATABASE_URL of ["postgresql://worker@project-pooler.example/infraforge", `${base.DATABASE_URL}?pgbouncer=true`,
    `${base.DATABASE_URL}?pool_mode=transaction`]) {
    expect(() => workerDatabaseUrl({ ...base, DATABASE_URL, WORKER_DATABASE_MODE: "direct" })).toThrow("transaction pooling");
  }
});

test("production dependency checks cannot fall back to ambient PostgreSQL or localhost Redis", () => {
  const endpoints = { DATABASE_URL: "postgresql://fixture@database/fixture", REDIS_HOST: "redis", REDIS_PORT: "6379" };
  expect(() => requireProductionEndpoints(endpoints)).not.toThrow();
  for (const missing of ["DATABASE_URL", "REDIS_HOST", "REDIS_PORT"]) {
    expect(() => requireProductionEndpoints({ ...endpoints, [missing]: undefined })).toThrow("explicit");
  }
  expect(() => requireProductionEndpoints({ ...endpoints, DATABASE_URL: "postgresql:///fixture" })).toThrow("invalid");
  expect(() => requireProductionEndpoints({ ...endpoints, REDIS_PORT: "NaN" })).toThrow("invalid");
});
