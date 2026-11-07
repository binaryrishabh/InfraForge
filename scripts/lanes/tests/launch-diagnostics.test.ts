// A launcher refusal must always say why, and no external process call may wait forever.
// Run: bun --no-env-file test ./scripts/lanes/tests/launch-diagnostics.test.ts
import { expect, test } from "bun:test";
import { launcherRefusal, redact, transientRefusal } from "../lib/launch";
import { run, type Ran } from "../lib/exec";

const ran = (p: Partial<Ran>): Ran => ({ stdout: "", stderr: "", status: 0, timedOut: false, error: "", ...p });

test("a launcher that prints nothing still gives a reason with the exit code", () => {
  const reason = launcherRefusal(ran({ status: 1 }));
  expect(reason).toMatch(/^launcher refused: exited with code 1/);
  expect(reason).toContain("printed nothing");
  expect(reason.trim().length).toBeGreaterThan("launcher refused:".length + 10);
});

test("timeouts, spawn errors and kills are named, never blank", () => {
  expect(launcherRefusal(ran({ status: null, timedOut: true }))).toContain("timed out");
  expect(launcherRefusal(ran({ status: null, error: "ENOENT: spawn pwsh ENOENT" }))).toContain("could not run (ENOENT");
  expect(launcherRefusal(ran({ status: null }))).toContain("killed before it exited");
});

test("the launcher's own message is kept (busy account, malformed state) and ANSI colour codes are dropped", () => {
  const r = launcherRefusal(ran({ status: 1, stderr: "\x1b[31;1mException: \x1b[0mAccount acc2 already has a running Codex session" }));
  expect(r).toContain("exited with code 1; output: Exception: Account acc2 already has a running Codex session");
  expect(r).not.toContain("\x1b");
});

test("secrets never reach the event log", () => {
  const leaked = "OPENAI_API_KEY=sk-abcdef1234567890abcdef token: ghp_ABCDEFGHIJKLMNOP1234 Authorization: Bearer abc.def.ghi";
  const out = redact(leaked);
  expect(out).not.toMatch(/sk-abcdef|ghp_ABC|abc\.def\.ghi/);
  expect(launcherRefusal(ran({ status: 2, stdout: leaked }))).not.toMatch(/sk-abcdef|ghp_ABC/);
});

test("only a machine that did not answer is retried; a real refusal is not", () => {
  expect(transientRefusal(ran({ status: null, timedOut: true }))).toBe(true);
  expect(transientRefusal(ran({ status: null, error: "EAGAIN: resource temporarily unavailable" }))).toBe(true);
  expect(transientRefusal(ran({ status: 1, stderr: "Account default already has a running Codex session" }))).toBe(false);
});

test("a hung child is killed at the bound instead of freezing the caller", () => {
  const started = Date.now();
  const r = run("bun", ["--no-env-file", "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 1500 });
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(r.timedOut).toBe(true);
  expect(launcherRefusal(r)).toContain("timed out");
});

test("a child that waits for input gets none and ends instead of hanging", () => {
  const r = run("bun", ["--no-env-file", "-e", "const t = await Bun.stdin.text(); console.log('read', t.length)"], { timeoutMs: 15_000 });
  expect(r.timedOut).toBe(false);
  expect(r.stdout).toContain("read 0");
});
