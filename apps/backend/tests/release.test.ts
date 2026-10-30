import { expect, test } from "bun:test";
import { inspectHistory, migrationManifest, migrationFingerprint } from "../release/migrations";
import { workerDatabaseUrl } from "../infra/workerConnection";
import { requireProductionEndpoints } from "../release/runtime";

test("release accepts only an unchanged ordered migration prefix", async () => {
  const manifest = await migrationManifest();
  expect(manifest).toHaveLength(31);
  expect(manifest[16]?.name).toBe("20261018000000_challenge_learning");
  expect(manifest[18]?.name).toBe("20261020000000_model2_lesson");
  expect(manifest[19]?.name).toBe("20261021000000_first_stack_submissions");
  expect(manifest[20]?.name).toBe("20261022000000_historical_replay");
  expect(manifest[21]?.name).toBe("20261023000000_account_essentials");
  expect(manifest.at(-4)?.name).toBe("20261028010000_browser_runs");
  expect(manifest.at(-3)?.name).toBe("20261029000000_async_queue_evidence");
  expect(manifest.at(-2)?.name).toBe("20261030000000_intervention_action_kind");
  expect(manifest.at(-1)?.name).toBe("20261030010000_challenge_scenarios");
  const rows = manifest.map((item) => ({ migration_name: item.name, checksum: item.checksum, finished_at: "done", rolled_back_at: null }));
  expect(inspectHistory(manifest, rows)).toBe(31);
  expect(inspectHistory(manifest, rows.slice(0, 20))).toBe(20);
  expect(inspectHistory(manifest, rows.slice(0, 21))).toBe(21);
  expect(inspectHistory(manifest, rows.slice(0, 17))).toBe(17);
  expect(inspectHistory(manifest, rows.slice(0, 8))).toBe(8);
  for (const invalid of [rows.slice(1), [...rows, rows[0]!], [{ ...rows[0]!, checksum: "edited" }],
    [{ ...rows[0]!, finished_at: null }], [{ ...rows[0]!, migration_name: "future" }]]) {
    expect(() => inspectHistory(manifest, invalid)).toThrow();
  }
  expect(migrationFingerprint(manifest)).toHaveLength(64);
});

test("production worker requires an explicitly supported connection mode", () => {
  const base = { NODE_ENV: "production", DATABASE_URL: "postgresql://worker@postgres/infraforge" };
  expect(() => workerDatabaseUrl(base)).toThrow("WORKER_DATABASE_MODE");
  expect(workerDatabaseUrl({ ...base, WORKER_DATABASE_MODE: "direct" })).toBe(base.DATABASE_URL);
  expect(workerDatabaseUrl({ ...base, WORKER_DATABASE_MODE: "session" })).toBe(base.DATABASE_URL);
  for (const DATABASE_URL of ["postgresql://worker@project-pooler.example/infraforge", `${base.DATABASE_URL}?pgbouncer=true`,
    `${base.DATABASE_URL}?pool_mode=transaction`]) {
    expect(() => workerDatabaseUrl({ ...base, DATABASE_URL, WORKER_DATABASE_MODE: "direct" })).toThrow("transaction pooling");
  }
});

test("production dependency checks cannot fall back to ambient PostgreSQL or localhost Redis", () => {
  const endpoints = { DATABASE_URL: "postgresql://fixture@database/fixture?sslmode=verify-full", REDIS_HOST: "redis", REDIS_PORT: "6379" };
  expect(() => requireProductionEndpoints(endpoints)).not.toThrow();
  for (const missing of ["DATABASE_URL", "REDIS_HOST", "REDIS_PORT"]) {
    expect(() => requireProductionEndpoints({ ...endpoints, [missing]: undefined })).toThrow("explicit");
  }
  expect(() => requireProductionEndpoints({ ...endpoints, DATABASE_URL: "postgresql:///fixture" })).toThrow("invalid");
  expect(() => requireProductionEndpoints({ ...endpoints, REDIS_PORT: "NaN" })).toThrow("invalid");
});

test("every migration after the original baseline is reviewed as additive, so populated upgrades can apply it", async () => {
  const { ADDITIVE_MIGRATIONS } = await import("../release/migrations");
  const manifest = await migrationManifest();
  const first = manifest.findIndex((migration) => migration.name === "20261009000000_capture_run_inputs");
  expect(first).toBeGreaterThan(0);
  const later = manifest.slice(first).map((migration) => migration.name);
  expect(later.filter((name) => !ADDITIVE_MIGRATIONS.has(name))).toEqual([]);
});
