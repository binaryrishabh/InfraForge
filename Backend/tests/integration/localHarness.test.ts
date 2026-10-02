import { describe, expect, test } from "bun:test";
import { childEnvironment, readLocalSettings } from "./localHarness";

const safe = {
  INTEGRATION_DISPOSABLE: "local-only",
  INTEGRATION_DATABASE_URL: "postgresql://postgres@127.0.0.1:55432/infraforge_it_0123abcd",
  INTEGRATION_REDIS_PORT: "56379",
};

describe("local integration safety guards", () => {
  test("requires explicit disposable service acknowledgement", () => {
    expect(() => readLocalSettings({ ...safe, INTEGRATION_DISPOSABLE: undefined })).toThrow();
    expect(() => readLocalSettings({ DATABASE_URL: safe.INTEGRATION_DATABASE_URL })).toThrow();
  });

  test("rejects ambient PostgreSQL overrides before opening a connection", () => {
    for (const name of ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGOPTIONS", "PGSSLMODE", "PGSSLNEGOTIATION"]) {
      expect(() => readLocalSettings({ ...safe, [name]: "untrusted" })).toThrow();
    }
  });

  test("rejects remote, ordinary, and ambiguous PostgreSQL targets", () => {
    for (const target of [
      "postgresql://postgres@example.com/infraforge_it_0123abcd",
      "postgresql://postgres@localhost/infraforge",
      "postgresql://postgres@localhost/infraforge_it_0123abcd?schema=public",
      "postgresql://postgres@localhost/infraforge_it_%30%31%32%33abcd",
      "http://localhost/infraforge_it_0123abcd",
      "postgresql://localhost/infraforge_it_0123abcd",
    ]) expect(() => readLocalSettings({ ...safe, INTEGRATION_DATABASE_URL: target })).toThrow();
  });

  test("child processes cannot inherit database, dotenv, or runtime injection settings", () => {
    const settings = readLocalSettings(safe);
    const result = childEnvironment(settings, {
      PATH: "system-path", DATABASE_URL: "wrong", REDIS_HOST: "wrong", PORT: "wrong",
      PGHOST: "wrong", PGOPTIONS: "wrong", PGPASSWORD: "wrong", PGSSLMODE: "wrong",
      DOTENV_CONFIG_PATH: "wrong", DOTENV_CONFIG_OVERRIDE: "true", NODE_OPTIONS: "wrong", BUN_OPTIONS: "wrong",
    });
    expect(result.PATH).toBe("system-path");
    expect(result.DATABASE_URL).toBe(settings.databaseUrl);
    expect(result.REDIS_HOST).toBe("127.0.0.1");
    expect(result.PORT).toBe("3100");
    expect(result.DOTENV_CONFIG_PATH).not.toBe("wrong");
    expect(result.DOTENV_CONFIG_OVERRIDE).toBe("false");
    for (const name of ["PGHOST", "PGOPTIONS", "PGPASSWORD", "PGSSLMODE", "NODE_OPTIONS", "BUN_OPTIONS"]) {
      expect(result).not.toHaveProperty(name);
    }
  });

  test("rejects missing, development, conflicting, and invalid Redis ports", () => {
    for (const value of [undefined, "6379", "3100", "3001", "0", "65536", "56379.5", "NaN", ""]) {
      expect(() => readLocalSettings({ ...safe, INTEGRATION_REDIS_PORT: value })).toThrow();
    }
  });

  test("allows normal API port only through an explicit isolated override", () => {
    expect(readLocalSettings(safe).apiPort).toBe(3100);
    expect(() => readLocalSettings({ ...safe, INTEGRATION_API_PORT: "3000" })).toThrow();
    expect(readLocalSettings({ ...safe, INTEGRATION_API_PORT: "3000", INTEGRATION_ALLOW_API_3000: "yes" }).apiPort).toBe(3000);
    expect(() => readLocalSettings({ ...safe, INTEGRATION_API_PORT: "3001" })).toThrow();
  });
});
