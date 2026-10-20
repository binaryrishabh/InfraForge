import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { IsolationConnection } from "../../apps/backend/firstStack/isolationConnection";
import { probeFirstStackContainer } from "../../apps/backend/firstStack/isolationRunner";
import { executorName, FIRST_STACK_ISOLATION as limits } from "../../apps/backend/firstStack/isolationPolicy";

export async function orphanChild(file: string) {
  const value = JSON.parse(await readFile(file, "utf8")), control = await IsolationConnection.open(value.endpoint);
  try {
    await probeFirstStackContainer(control, value.configuration, { mode: "execute", input: value.input }, {
      assertHeld: async () => {},
      commit: async cut => {
        await writeFile(value.cutFile, JSON.stringify(cut), { flag: "wx" });
        // Parent kills this process after the durable store has acknowledged.
        await new Promise<void>(() => {});
      },
    });
  } finally { await control.close(); }
}
export async function orphanProof(control: IsolationConnection, configuration: { image: string; source: string }, input: string, output: string) {
  const requestFile = resolve(output, "orphan-request.json"), cutFile = resolve(output, "orphan-cut.json");
  await writeFile(requestFile, JSON.stringify({ endpoint: control.endpoint, configuration, input, cutFile }));
  const env: Record<string, string> = {};
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME"]) if (process.env[key]) env[key] = process.env[key]!;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", "scripts/first-stack-host/qualify.ts", `--orphan-child=${requestFile}`],
    { env, stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true });
  const start = Date.now(); let container = "", original = "", token = "", state: any;
  try {
    while (Date.now() - start < 30000) {
      try { original = await readFile(cutFile, "utf8"); break; } catch { await Bun.sleep(100); }
    }
    if (!original) throw Error("Orphan producer did not persist its initial prefix");
    state = JSON.parse(await control.run(["inspect", executorName]))[0];
    container = state.Id; token = state.Config?.Labels?.["infraforge.first-stack"];
    if (state.Image !== configuration.image || !token || !state.State.Running) throw Error("Orphan container ownership is unavailable");
    child.kill("SIGKILL");
    await child.exited;
    const duplicate = await probeFirstStackContainer(control, configuration, { mode: "execute", input }, { assertHeld: async () => {}, commit: async () => {} });
    if (duplicate.receipt.container !== null || duplicate.status !== "interrupted") throw Error("Replacement overlapped the orphan");
    while (Date.now() - start < limits.supervisorMs) {
      state = JSON.parse(await control.run(["inspect", container]))[0];
      if (!state.State.Running) break;
      await Bun.sleep(500);
    }
    const unchanged = await readFile(cutFile, "utf8") === original;
    // Losing stdin can stop the process before its independent deadline, with
    // even a zero exit. No parent received a terminal protocol; that is never
    // a completed run. The durable prefix and occupied name are authoritative.
    return { passed: !state.State.Running && Date.now() - start < limits.supervisorMs && unchanged,
      elapsedMs: Date.now() - start, exit: state.State.ExitCode, prefixSequence: JSON.parse(original).cut.sequence, unchanged,
      terminalProtocol: "Unavailable after worker death; process exit alone cannot complete a run",
      replacement: { status: duplicate.status, created: duplicate.receipt.container } };
  } finally {
    child.kill("SIGKILL"); await child.exited;
    if (container) {
      const v = JSON.parse(await control.run(["inspect", container]))[0];
      if (v.Image !== configuration.image || v.Config?.Labels?.["infraforge.first-stack"] !== token) throw Error("Orphan cleanup ownership changed");
      await control.run(["rm", "--force", container]);
    }
    await writeFile(join(output, "orphan-observation.json"), JSON.stringify({ container, token, observedExit: state?.State?.ExitCode ?? null }));
  }
}
