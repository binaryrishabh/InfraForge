import type { Ran } from "./exec";

// Never put credentials in an event log: blank anything that looks like a token, key or secret assignment.
export const redact = (t: string) =>
  t.replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\b(sk|ghp|gho|github_pat|xox[a-z]|AKIA)[-_A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/((?:token|key|secret|password|authorization|bearer)[A-Za-z_]*\s*[=:]\s*(?:bearer\s+)?)\S+/gi, "$1[redacted]");

/* What the launcher printed, or why it printed nothing. Always names something: the exit code, a timeout, a spawn error, or the output. */
export function launcherRefusal(r: Ran): string {
  const out = redact(`${r.stdout}\n${r.stderr}`).replace(/\s+/g, " ").trim().slice(0, 400);
  const how = r.timedOut ? "timed out (the launcher or PowerShell did not answer in time)"
    : r.error ? `could not run (${redact(r.error)})`
    : r.status === null ? "was killed before it exited"
    : `exited with code ${r.status}`;
  return `launcher refused: ${how}${out ? `; output: ${out}` : "; it printed nothing"}`;
}
/* Refusals that can pass by themselves (a busy machine) are retried; a real refusal (bad state, busy account) is not. */
export const transientRefusal = (r: Ran) => r.timedOut || !!r.error || r.status === null;
