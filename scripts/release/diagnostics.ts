import { randomUUID } from "node:crypto";
import { lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

const sensitive = /PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|DATABASE_URL/i;
const configurationContext = /\b(?:dotenv|env(?:ironment)?(?:[-_\s]*files?)?|interpolat\w*|templates?|variables?)\b|\$\{|\bline\s+\d+\s*:/i;
const configurationReadFailure = /\b(?:failed|unable|cannot|could not|error)\b[^\r\n]*\b(?:read(?:ing)?|load(?:ing)?|pars(?:e|ing))\b/i;
type DiagnosticStat = { ino: number; dev: number; uid: number; mode: number; isFile(): boolean };
export function assertPrivateDiagnostic(opened: DiagnosticStat, named: DiagnosticStat) {
  if (!named.isFile() || named.ino !== opened.ino || named.dev !== opened.dev || opened.uid !== 0 || (opened.mode & 0o777) !== 0o600) {
    throw new Error("Root ownership/mode of private diagnostic not verified");
  }
}
export function redactReleaseDiagnostic(text: string, environment: Record<string, string | undefined>) {
  let result = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  // Configuration errors can echo templates or required-variable reasons without
  // their assignment keys. Suppress their entire payload by context, including
  // ambiguous read/parse failures and continuation lines; error wording varies.
  if (configurationContext.test(result) || configurationReadFailure.test(result)) {
    return "[redacted Compose configuration/interpolation diagnostic; inspect private configuration syntax]";
  }
  // Replace known secret values before taking the tail, even if they contain
  // punctuation, whitespace or newlines. Compose's env-file values are also
  // covered by the URL/assignment rules below without reading the private file.
  for (const value of Object.entries(environment).filter(([key, value]) => sensitive.test(key) && value)
    .map(([, value]) => value!).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(value, "[redacted]").replaceAll(encodeURIComponent(value), "[redacted]");
  }
  return result
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "[redacted URL]")
    .replace(/\b(Bearer|Basic)\s+[^\s,"']+/gi, "$1 [redacted]")
    .replace(/(["']?[\w.-]*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|DATABASE_URL)[\w.-]*["']?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|[^\r\n,;]+)/gi, "$1[redacted]");
}

export async function secureRootDiagnostic(path: string, file: FileHandle) {
  if (process.platform !== "linux") throw new Error("Root-owned release diagnostics require Linux");
  if (process.getuid?.() === 0) await file.chown(0, 0);
  else {
    // No shell and no stderr contents in argv. The release operator already
    // controls Docker; the host must also permit this noninteractive chown.
    const child = Bun.spawn(["sudo", "-n", "chown", "--no-dereference", "0:0", "--", path],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { if (await child.exited !== 0) throw new Error("Noninteractive sudo chown failed"); }
    finally { clearTimeout(timeout); }
  }
  const [opened, named] = await Promise.all([file.stat(), lstat(path)]);
  assertPrivateDiagnostic(opened, named);
}

export async function writeComposeDiagnostic(stderr: string, directory: string, environment: Record<string, string | undefined>,
  secure = secureRootDiagnostic, filename = () => `compose-error-${Date.now()}-${randomUUID()}.log`) {
  const path = resolve(directory, filename());
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(redactReleaseDiagnostic(stderr, environment).slice(-16000) + "\n");
    await file.sync();
    await secure(path, file);
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  } finally { await file.close(); }
  return path;
}

export async function composeFailureDetail(stderr: string, directory: string, environment: Record<string, string | undefined>, write = writeComposeDiagnostic) {
  try { return `private stderr tail: ${await write(stderr, directory, environment)} (read with sudo)`; }
  catch { return "private stderr tail could not be secured; check state-directory capacity/permissions and noninteractive sudo chown (no stderr printed)"; }
}
