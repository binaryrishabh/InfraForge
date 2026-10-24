import { expect, test } from "bun:test";
import { postgresUrl } from "../utils/postgresUrl";
import { requireProductionEndpoints } from "../release/runtime";
import { workerDatabaseUrl } from "../infra/workerConnection";

test("remote PostgreSQL requires verified TLS regardless of provider or private address", () => {
  for (const host of ["db.example.invalid", "ep-fixture.aws.neon.tech", "10.0.0.8", "localhost", "127.0.0.1", "[::1]", "postgres:6432"]) {
    const url = `postgresql://fixture:password@${host}/app`;
    expect(postgresUrl(`${url}?sslmode=verify-full`).hostname).toBeDefined();
    for (const query of ["", "?sslmode=require", "?sslmode=prefer", "?sslmode=disable", "?sslmode=verify-ca"]) {
      expect(() => postgresUrl(url + query)).toThrow("verify-full");
    }
  }
});

test("only the private Compose service permits plaintext in production", () => {
  for (const url of ["postgresql://fixture:password@postgres/app", "postgresql://fixture:password@postgres:5432/app?sslmode=disable"]) {
    expect(postgresUrl(url, true).hostname).toBe("postgres");
    expect(() => requireProductionEndpoints({ DATABASE_URL: url, REDIS_HOST: "redis", REDIS_PORT: "6379" })).not.toThrow();
    expect(workerDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url, WORKER_DATABASE_MODE: "direct" })).toBe(url);
  }
});

test("redirects, duplicate options and TLS overrides cannot escape the URL policy", () => {
  const remote = "postgresql://fixture:password@db.example.invalid/app?sslmode=verify-full";
  for (const extra of ["&sslmode=disable", "&sslmode=verify-full", "&host=postgres", "&hostaddr=127.0.0.1", "&service=other",
    "&ssl=false", "&sslrootcert=other", "&options=-csearch_path=other", "&channel_binding=disable", "#fragment"]) {
    expect(() => postgresUrl(remote + extra)).toThrow();
  }
  expect(postgresUrl(remote + "&channel_binding=require").hostname).toBe("db.example.invalid");
  for (const url of [undefined, "not-a-url", "https://user@db/app", "postgresql://db/app", "postgresql://user@db/"]) {
    expect(() => postgresUrl(url)).toThrow();
  }
});

test("API pooling is allowed but known transaction endpoints cannot own sessions", () => {
  const url = "postgresql://fixture:password@ep-fixture-pooler.example.invalid/app?sslmode=verify-full";
  expect(() => postgresUrl(url)).not.toThrow();
  expect(() => postgresUrl(url, true)).toThrow("transaction pooling");
  for (const query of ["pgbouncer=true", "pool_mode=transaction", "pool_mode=session"]) {
    expect(() => postgresUrl(`postgresql://fixture@postgres/app?${query}`, true)).toThrow("transaction pooling");
  }
  // The existing live two-session advisory-lock probe remains necessary for
  // poolers whose hostnames do not reveal their pooling mode.
  expect(() => workerDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: url, WORKER_DATABASE_MODE: "direct" })).toThrow();
  expect(() => requireProductionEndpoints({ DATABASE_URL: "postgresql://fixture@db/app", REDIS_HOST: "redis", REDIS_PORT: "6379" })).toThrow("verify-full");
});
