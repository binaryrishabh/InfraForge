import { composeFailureDetail, redactReleaseDiagnostic } from "./diagnostics";

const children = new Set<ReturnType<typeof Bun.spawn>>();
export async function cancelCommands() {
  const owned = [...children];
  for (const child of owned) child.kill("SIGKILL");
  await Promise.allSettled(owned.map((child) => child.exited));
}

export async function command(args: string[], cwd: string, env: Record<string, string | undefined> = process.env, diagnosticsDirectory?: string) {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  children.add(child);
  const timeout = setTimeout(() => child.kill("SIGKILL"), (args[1] === "build" || args[1] === "buildx" && args[2] === "build") ? 600000 : 120000);
  const [output, diagnostic] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => { clearTimeout(timeout); children.delete(child); });
  if (await child.exited !== 0) {
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
