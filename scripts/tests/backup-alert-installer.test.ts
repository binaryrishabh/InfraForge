import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const installer = "ops/home/install-backup-alert.sh";
const roots: string[] = [];
// Generated, non-deliverable test data; the owner supplies the real recipient at install time.
const recipient = () => `${randomUUID()}@${randomUUID()}.invalid`;
const paths = ["usr/local/sbin/infraforge-backup-alert", "etc/systemd/system/infraforge-backup-alert.service",
  "etc/systemd/system/infraforge-backup.service.d/10-alert.conf", "etc/infraforge/ops/alert.env"];
function fixture(settings = "TRANSACTIONAL_EMAIL_FROM=\nRESEND_API_KEY=\n") {
  const root = mkdtempSync(join(process.cwd(), ".backup-alert-test-"));
  roots.push(root);
  mkdirSync(join(root, "etc/infraforge"), { recursive: true });
  writeFileSync(join(root, "etc/infraforge/release.env"), settings);
  return root;
}
function run(root: string, ...args: string[]) {
  const shellRoot = process.platform === "win32" ? root.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`) : root;
  // NUL-delimited stdin preserves CR/LF cases that Windows process argument conversion strips.
  const child = Bun.spawnSync(["bash", "-c", 'mapfile -d "" -t args; exec bash "$@" "${args[@]}"', "_", installer, "--root", shellRoot], {
    stdin: Buffer.from(args.length ? `${args.join("\0")}\0` : ""), env: { ...process.env, ALERT_EMAIL: recipient() },
  });
  return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString() };
}
function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name)).sort();
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("requires an explicit email, even with an environment recipient", () => {
  const root = fixture();
  const result = run(root);
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("--email");
  expect(files(root)).toEqual([join(root, "etc/infraforge/release.env")]);
});

test("rejects malformed or unsafe recipients without echoing them", () => {
  const address = recipient();
  const invalid = ["", "missing-at", `@${address.split("@")[1]}`, `${address}@extra`, `${address} `,
    `${address}\t`, `${address}\n`, `${address}\r`, `${address}\x01`, `${address}'`, `${address}\"`,
    `${address}\\`, `${"x".repeat(255)}@invalid`, `.${address}`, address.replace("@", "..@")];
  const root = fixture();
  for (const [index, value] of invalid.entries()) {
    const result = run(root, "--email", value);
    expect(result.code, `invalid case ${index}`).not.toBe(0);
    expect(result.output).toContain("Invalid email");
    if (value) expect(result.output).not.toContain(value);
  }
  expect(files(root)).toHaveLength(1);
});

test("dry run lists every planned file and systemctl skip without changing anything", () => {
  const root = fixture();
  const address = recipient();
  const result = run(root, "--email", address, "--dry-run");
  expect(result.code).toBe(0);
  for (const path of paths) expect(result.output).toContain(path);
  expect(result.output).toContain("systemctl skipped");
  expect(result.output).not.toContain(address);
  expect(files(root)).toHaveLength(1);
});

test("installs exact files and drop-in, preserves the backup unit, and stores the recipient only in alert.env", () => {
  const root = fixture();
  const address = recipient();
  const backup = join(root, "etc/systemd/system/infraforge-backup.service");
  mkdirSync(resolve(backup, ".."), { recursive: true });
  writeFileSync(backup, "[Unit]\nDescription=Existing backup\n");
  const result = run(root, "--email", address);
  expect(result.code).toBe(0);
  expect(result.output).not.toContain(address);
  expect(result.output).toContain(`${address[0]}***@${address.split("@")[1]![0]}***.invalid`);
  expect(readFileSync(join(root, paths[0]!), "utf8")).toBe(readFileSync("ops/home/backup-alert.sh", "utf8"));
  expect(readFileSync(join(root, paths[1]!), "utf8")).toBe(readFileSync("ops/home/infraforge-backup-alert.service", "utf8"));
  expect(readFileSync(join(root, paths[2]!), "utf8")).toBe("[Unit]\nOnFailure=infraforge-backup-alert.service\n");
  expect(readFileSync(join(root, paths[3]!), "utf8")).toBe(`ALERT_EMAIL=${address}\n`);
  expect(readFileSync(backup, "utf8")).toBe("[Unit]\nDescription=Existing backup\n");
  for (const file of files(root)) if (file !== join(root, paths[3]!)) expect(readFileSync(file, "utf8")).not.toContain(address);
});

test.skipIf(process.platform === "win32")("enforces Unix modes and leaves identical installs untouched", () => {
  const root = fixture();
  const address = recipient();
  expect(run(root, "--email", address).code).toBe(0);
  for (const [index, mode] of [0o755, 0o644, 0o644, 0o600].entries()) {
    const metadata = statSync(join(root, paths[index]!));
    expect(metadata.mode & 0o777).toBe(mode);
    if (process.getuid?.() === 0) { expect(metadata.uid).toBe(0); expect(metadata.gid).toBe(0); }
  }
  const before = paths.map((path) => statSync(join(root, path)).ctimeMs);
  const result = run(root, "--email", address);
  expect(result.code).toBe(0);
  expect(result.output).toContain("No changes");
  expect(paths.map((path) => statSync(join(root, path)).ctimeMs)).toEqual(before);
});

test("uninstall removes exactly the four managed files, works twice and needs no email or keys", () => {
  const root = fixture();
  expect(run(root, "--email", recipient()).code).toBe(0);
  const keep = join(root, "etc/systemd/system/infraforge-backup.service.d/20-owner.conf");
  writeFileSync(keep, "owner configuration\n");
  rmSync(join(root, "etc/infraforge/release.env"));
  expect(run(root, "--uninstall", "--dry-run").code).toBe(0);
  for (const path of paths) expect(existsSync(join(root, path))).toBe(true);
  expect(run(root, "--uninstall").code).toBe(0);
  expect(files(root)).toEqual([keep]);
  const again = run(root, "--uninstall");
  expect(again.code).toBe(0);
  expect(again.output).toContain("No changes");
});

test("missing sender, key or release file refuses before creating any destinations", () => {
  for (const settings of ["", "TRANSACTIONAL_EMAIL_FROM=\n", "RESEND_API_KEY=\n", "# RESEND_API_KEY=\nTRANSACTIONAL_EMAIL_FROM=\n"]) {
    const root = fixture(settings);
    const result = run(root, "--email", recipient());
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("requires TRANSACTIONAL_EMAIL_FROM and RESEND_API_KEY lines");
    expect(files(root)).toHaveLength(1);
  }
  const root = fixture();
  rmSync(join(root, "etc/infraforge/release.env"));
  expect(run(root, "--email", recipient()).code).not.toBe(0);
  expect(files(root)).toHaveLength(0);
});

test("send-test refuses staging and dry-run; invalid options fail before installation", () => {
  const root = fixture();
  for (const args of [["--email", recipient(), "--send-test"], ["--email", recipient(), "--dry-run", "--send-test"],
    ["--unknown"], ["--email"], ["--root"], ["--root", "/"], ["--uninstall", "--send-test"]]) {
    expect(run(root, ...args).code).not.toBe(0);
  }
  expect(files(root)).toHaveLength(1);
});
