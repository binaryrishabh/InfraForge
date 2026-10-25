import { composeFailureDetail, redactReleaseDiagnostic } from "./diagnostics";
import { localDockerEnvironment } from "./docker-endpoint";
import type { ReadableStreamDefaultReader } from "node:stream/web";

const children = new Set<ReturnType<typeof Bun.spawn>>();
export async function cancelCommands() {
  const owned = [...children];
  for (const child of owned) child.kill("SIGKILL");
  await Promise.race([Promise.allSettled(owned.map((child) => child.exited)), Bun.sleep(2000)]);
}

type CommandChild = { stdout: ReadableStream<Uint8Array>; stderr: ReadableStream<Uint8Array>; exited: Promise<number>; kill: (signal: "SIGKILL") => void };
export async function collectCommand(child: CommandChild, milliseconds: number, limit = 16 * 1024 * 1024) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let bytes = 0;
  async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error("Release command output limit exceeded");
      text += decoder.decode(chunk.value, { stream: true });
    }
  }
  try {
    return await Promise.race([
      Promise.all([read(readers[0]!), read(readers[1]!), child.exited]),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Release command deadline exceeded")), milliseconds); }),
    ]);
  } catch (error) {
    // Reject without waiting for sudo/descendants to release inherited pipes or exit.
    try { child.kill("SIGKILL"); } catch { /* It may already have exited. */ }
    for (const reader of readers) void reader.cancel().catch(() => {});
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function command(args: string[], cwd: string, env: Record<string, string | undefined> = process.env, diagnosticsDirectory?: string) {
  if (args[0] === "docker" && args[1] !== "context" && env.RELEASE_REHEARSAL !== "owned-local") env = localDockerEnvironment(env);
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  children.add(child);
  const [output, diagnostic, exitCode] = await collectCommand(child,
    (args[1] === "build" || args[1] === "buildx" && args[2] === "build") ? 600000 : 120000)
    .finally(() => { children.delete(child); });
  if (exitCode !== 0) {
    const detail = env.RELEASE_REHEARSAL === "owned-local" ? redactReleaseDiagnostic(diagnostic, env).slice(-2000)
      : args[0] === "docker" && args[1] === "compose" && diagnosticsDirectory
        ? await composeFailureDetail(diagnostic, diagnosticsDirectory, env) : "inspect private operator diagnostics";
    // Readiness retries may catch this exception. Report the private path here
    // as well so their eventual deadline never hides the operator's evidence.
    if (args[0] === "docker" && args[1] === "compose" && diagnosticsDirectory && env.RELEASE_REHEARSAL !== "owned-local") {
      console.error(`docker compose failed; ${detail}`);
    }
    throw new Error(`${args[0]} ${args[1] ?? ""} failed; ${detail}`);
  }
  return output.trim();
}

export async function waitFor(check: () => Promise<boolean>, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(500);
  }
  throw new Error("Release readiness deadline exceeded");
}
