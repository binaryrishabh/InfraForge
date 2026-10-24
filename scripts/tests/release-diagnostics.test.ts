import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPrivateDiagnostic, composeFailureDetail, redactReleaseDiagnostic, secureRootDiagnostic, writeComposeDiagnostic } from "../release/diagnostics";
import * as diagnostics from "../release/diagnostics";
import * as processTools from "../release/process";
import { ComposeRelease } from "../release/compose";

const environment = { BETTER_AUTH_SECRET: "synthetic secret\nwith spaces", GOOGLE_CLIENT_SECRET: "synthetic&oauth", PATH: "public-path" };
const stderr = `compose failed: no space left on device
postgresql://fixture:synthetic-db@db.invalid/app?sslmode=verify-full
https://api.invalid/reset?token=synthetic-link redis://fixture:synthetic-redis@cache.invalid
BETTER_AUTH_SECRET="${environment.BETTER_AUTH_SECRET}"
POSTGRES_PASSWORD: 'synthetic-password' token=synthetic-token
Authorization: Bearer synthetic-bearer Basic synthetic-basic
${encodeURIComponent(environment.GOOGLE_CLIENT_SECRET)}
`;

test("diagnostic ownership verification refuses non-root, permissive modes and a replaced path or symlink", () => {
  const valid = { ino: 10, dev: 1, uid: 0, mode: 0o100600, isFile: () => true };
  expect(() => assertPrivateDiagnostic(valid, valid)).not.toThrow();
  for (const change of [{ uid: 1000 }, { mode: 0o100644 }, { mode: 0o100400 }])
    expect(() => assertPrivateDiagnostic({ ...valid, ...change }, valid)).toThrow("not verified");
  for (const change of [{ ino: 11 }, { dev: 2 }, { isFile: () => false }])
    expect(() => assertPrivateDiagnostic(valid, { ...valid, ...change })).toThrow("not verified");
});

test("diagnostic redaction covers URLs, secret values/assignments and authorization without losing the failure", () => {
  const redacted = redactReleaseDiagnostic(stderr, environment);
  expect(redacted).toContain("no space left on device");
  for (const value of ["synthetic", "db.invalid", "api.invalid", "cache.invalid", "postgresql://", "https://", "redis://"])
    expect(redacted).not.toContain(value);
  expect(redactReleaseDiagnostic('"GITHUB_CLIENT_SECRET": "synthetic-json", API_KEY=synthetic-key', {})).not.toContain("synthetic");
}, 30000);

test("raw known credentials without a key, URL or encoded spelling are removed", () => {
  const secret = "review raw%credential";
  const redacted = redactReleaseDiagnostic(`upstream rejected ${secret} during login`, { BETTER_AUTH_SECRET: secret });
  expect(redacted).toContain("upstream rejected [redacted] during login");
  expect(redacted).not.toContain("credential");
});

for (const [label, diagnostic] of [
  ["env-file Invalid template", 'failed to read /tmp/w50-review/synthetic.env: Invalid template: "review-fixture-db-password${"'],
  ["bare Invalid template", 'Invalid template: "review-fixture-db-password${"'],
  ["env-file required-variable reason", 'failed to read /tmp/w50-review/synthetic.env: required variable W50_NONEXISTENT is missing a value: review-fixture-db-password'],
  ["bare required-variable reason", 'required variable W50_NONEXISTENT is missing a value: review-fixture-db-password'],
  ["unfamiliar dotenv failure", 'dotenv: unfamiliar failure: review-fixture-db-password'],
  ["unfamiliar configuration read failure", 'failed to read /private/settings: unfamiliar failure: review-fixture-db-password'],
]) test(`persisted configuration failures suppress ${label}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-interpolation-diagnostic-"));
  try {
    // Actual Compose stderr forms carry an env-file-only value, without the
    // sensitive assignment key. No known-value substitution can protect it.
    const path = await writeComposeDiagnostic(diagnostic, directory, {}, async () => {});
    const saved = await readFile(path, "utf8");
    expect(saved).not.toContain("review-fixture-db-password");
    expect(saved).toBe("[redacted Compose configuration/interpolation diagnostic; inspect private configuration syntax]\n");
  } finally { await rm(directory, { recursive: true }); }
}, 30000);

test("persisted diagnostics suppress env-only parser payloads and multiline or escaped secret fragments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-parser-diagnostic-"));
  const examples = [
    'line 1: unterminated quoted value "review-first-secret\nreview-second-secret',
    'line 2: unexpected character "!" in variable name "review-first-secret"\nreview-second-secret',
    'invalid interpolation format for "review-first-secret"\nreview-second-secret',
    'POSTGRES_PASSWORD="review-first-secret\nreview-second-secret"',
    String.raw`POSTGRES_PASSWORD="review-first-secret\"review-second-secret"`,
    String.raw`POSTGRES_PASSWORD='review-first-secret\'review-second-secret'`,
    'POSTGRES_PASSWORD="review-first-secret\nreview-second-secret',
    'POSTGRES_PASSWORD=review-first-secret review-second-secret',
  ];
  try {
    for (const input of examples) {
      const path = await writeComposeDiagnostic(input, directory, {}, async () => {});
      const saved = await readFile(path, "utf8");
      expect(saved).toContain("redacted");
      expect(saved).not.toContain("review-first-secret");
      expect(saved).not.toContain("review-second-secret");
    }
  } finally { await rm(directory, { recursive: true }); }
}, 30000);

test("diagnostic filename collisions preserve the existing evidence instead of overwriting it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-diagnostic-collision-"));
  try {
    const name = () => "compose-error-collision.log";
    const path = await writeComposeDiagnostic("original evidence", directory, {}, async () => {}, name);
    await expect(writeComposeDiagnostic("replacement evidence", directory, {}, async () => {}, name)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path, "utf8")).toBe("original evidence\n");
    expect(await readdir(directory)).toEqual([name()]);
  } finally { await rm(directory, { recursive: true }); }
}, 30000);

test("the diagnostic file contains only a redacted bounded tail, uses an exclusive private file, and calls ownership security", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-diagnostic-"));
  try {
    const secured: string[] = [];
    const secure: typeof secureRootDiagnostic = async (path, file) => {
      secured.push(path);
      if (process.platform !== "win32") expect((await file.stat()).mode & 0o777).toBe(0o600);
    };
    const path = await writeComposeDiagnostic("prefix".repeat(4000) + stderr, directory, environment, secure);
    expect(secured).toEqual([path]);
    expect(path).toStartWith(join(directory, "compose-error-"));
    const text = await readFile(path, "utf8");
    expect(text).toHaveLength(16001);
    expect(text).toContain("no space left on device");
    expect(text).not.toContain("synthetic");
    const second = await writeComposeDiagnostic(stderr, directory, environment, secure);
    expect(second).not.toBe(path);
    await expect(writeComposeDiagnostic(stderr, directory, environment, async () => { throw new Error("ownership refused"); })).rejects.toThrow("ownership refused");
    expect(await readdir(directory)).toHaveLength(2);
    const detail = await composeFailureDetail(stderr, directory, environment, async () => { throw new Error("synthetic-secret must stay private"); });
    expect(detail).toContain("could not be secured");
    expect(detail).not.toContain("synthetic");
  } finally { await rm(directory, { recursive: true }); }
}, 30000);

test("production compose command failure reports the secured diagnostic path and never stderr", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-command-diagnostic-"));
  const reported = spyOn(console, "error").mockImplementation(() => {});
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => ({
    stdout: new Blob([""]).stream(), stderr: new Blob([stderr]).stream(), exited: Promise.resolve(1), kill: () => {},
  }) as unknown as ReturnType<typeof Bun.spawn>);
  const originalDetail = composeFailureDetail;
  const detail = spyOn(diagnostics, "composeFailureDetail").mockImplementation((text, path, env) =>
    originalDetail(text, path, env, (content, folder, vars) => writeComposeDiagnostic(content, folder, vars, async () => {})));
  try {
    const error = await processTools.command(["docker", "compose", "up"], ".", environment, directory).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(join(directory, "compose-error-"));
    expect(String(error)).toContain("read with sudo");
    expect(String(error)).not.toContain("synthetic");
    const [name] = await readdir(directory);
    expect(await readFile(join(directory, name!), "utf8")).toBe(redactReleaseDiagnostic(stderr, environment) + "\n");
    expect(detail).toHaveBeenCalledTimes(1);
    expect(reported).toHaveBeenCalledWith(String(error).replace(/^Error: /, ""));
  } finally { spawn.mockRestore(); detail.mockRestore(); reported.mockRestore(); await rm(directory, { recursive: true }); }
}, 30000);

test("Compose passes the release state directory to command diagnostics", async () => {
  const run = spyOn(processTools, "command").mockResolvedValue("");
  try {
    const release = { sha: "accepted", image: "infraforge-backend:accepted", imageId: "id", authContract: 1, migrationFingerprint: "schema", settingsFingerprint: "settings" };
    const operations = new ComposeRelease(".", "synthetic-config", "infraforge", release, async () => {}, undefined, 1, environment, "private-state");
    await operations.compose(["config"]);
    expect(run.mock.calls[0]?.[3]).toBe("private-state");
    expect(run.mock.calls[0]?.[2]?.BETTER_AUTH_SECRET).toBe(environment.BETTER_AUTH_SECRET);
  } finally { run.mockRestore(); }
});

test.skipIf(process.platform !== "linux" || process.getuid?.() !== 0)("Linux root diagnostic verifies actual root ownership and 0600 mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-root-diagnostic-"));
  try {
    const path = await writeComposeDiagnostic(stderr, directory, environment);
    const { stat } = await import("node:fs/promises");
    const file = await stat(path);
    expect(file.uid).toBe(0);
    expect(file.mode & 0o777).toBe(0o600);
  } finally { await rm(directory, { recursive: true }); }
});
