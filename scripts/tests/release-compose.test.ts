import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test.skipIf(!Bun.which("docker"))("external rehearsal renders its own postgres role and host authentication", () => {
  // Render only: no engine, images, credentials, containers or env files.
  const source = readFileSync("scripts/release/external-rehearse.ts", "utf8");
  const postgres = source.match(/^  postgres:\r?\n[\s\S]*?(?=^  tools:)/m)?.[0];
  expect(postgres).toBeDefined();
  const override = `services:\n${postgres!.replaceAll("${suffix}", "fixture")}volumes:\n  reference_data:\n`;
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
  Object.assign(environment, { RELEASE_SHA: "a".repeat(40), RELEASE_IMAGE: "fixture:image", DATABASE_URL: "postgresql://fixture:synthetic@postgres/app",
    MIGRATION_DATABASE_URL: "postgresql://fixture:synthetic@postgres/app", WORKER_DATABASE_URL: "postgresql://fixture:synthetic@postgres/app",
    WORKER_DATABASE_MODE: "direct", BETTER_AUTH_SECRET: "synthetic", BETTER_AUTH_URL: "https://api.example.invalid", APP_ORIGINS: "https://app.example.invalid" });
  const rendered = Bun.spawnSync(["docker", "compose", "--project-name", "fixture", "--env-file", process.platform === "win32" ? "NUL" : "/dev/null",
    "-f", "apps/backend/docker-compose.yml", "-f", "-", "--profile", "database", "config", "--format", "json"],
  { env: environment, stdin: new TextEncoder().encode(override) });
  expect(rendered.exitCode).toBe(0);
  const db = JSON.parse(rendered.stdout.toString()).services.postgres;
  expect(db.environment.POSTGRES_USER).toBe("postgres");
  expect(db.environment.POSTGRES_DB).toBe("infraforge_reference_fixture");
  expect(db.environment.POSTGRES_HOST_AUTH_METHOD).toBe("trust");
  expect(db.environment.POSTGRES_INITDB_ARGS).toBe("--auth-host=trust");
  expect(db.volumes.find((volume: { target: string }) => volume.target === "/var/lib/postgresql").source).toBe("reference_data");
  expect(db.ports.every((port: { host_ip: string }) => port.host_ip === "127.0.0.1")).toBe(true);
});
