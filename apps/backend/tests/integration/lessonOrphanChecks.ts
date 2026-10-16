import { expect } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSandbox } from "../../internalModel2/sandboxRunner";
import { DockerConnection } from "../../internalModel2/dockerConnection";
import { containerName, inspectContainer, removeContainer } from "../../internalModel2/sandboxDocker";
import { until } from "./localHarness";
export async function checkOrphanDeadline(control: DockerConnection, image: string, output: string) {
  const id = crypto.randomUUID(), name = containerName(id), receiptPath = join(output, `orphan-ready-${id}.json`), script = join(output, `orphan-parent-${id}.ts`);
  const runner = fileURLToPath(new URL("../../internalModel2/sandboxRunner.ts", import.meta.url)).replaceAll("\\", "/");
  const connector = fileURLToPath(new URL("../../internalModel2/dockerConnection.ts", import.meta.url)).replaceAll("\\", "/");
  await Bun.write(script, `import {runSandbox} from ${JSON.stringify(runner)}; import {DockerConnection} from ${JSON.stringify(connector)}; await DockerConnection.use(async(c)=>{if(JSON.stringify(c.receipt)!==${JSON.stringify(JSON.stringify(control.receipt))})throw Error('Orphan endpoint identity changed');await runSandbox(c,${JSON.stringify(id)},${JSON.stringify(image)},{fixture:'wall'},async()=>{},async(r)=>{if(r.enforcement)await Bun.write(${JSON.stringify(receiptPath)},JSON.stringify(r))})});`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|MODEL2_LESSON_ENDPOINT|MODEL2_LESSON_DOCKER_MODE|NODE_ENV|CI|GITHUB_ACTIONS|M2M_RUN|INTEGRATION_DISPOSABLE)$/i.test(key))) as Record<string, string>;
  const parent = Bun.spawn([process.execPath, "--no-env-file", "--no-install", script], { env, stdout: "ignore", stderr: "ignore" }), started = Date.now();
  try {
    const ready = await until(async () => { try { const value = await Bun.file(receiptPath).json(); return value.enforcement ? value : undefined; } catch { return undefined; } }, "independent executor handshake", 10000);
    parent.kill("SIGKILL"); await parent.exited;
    expect((await inspectContainer(control, name)).State.Running).toBe(true);
    let overlap = "";
    try { await runSandbox(control, crypto.randomUUID(), image, { fixture: "wall" }, async () => {}, async () => {}); }
    catch (error) { overlap = error instanceof Error ? error.message : String(error); }
    expect(overlap).toContain("still active");
    const state = await until(async () => { const value = (await inspectContainer(control, name)).State; return value.Running ? undefined : value; }, "container-internal deadline after parent SIGKILL", 22000, 250);
    expect(state.ExitCode).not.toBe(0); expect(state.OOMKilled).toBe(false);
    const elapsedMs = Date.now() - started; expect(elapsedMs).toBeGreaterThanOrEqual(14000); expect(elapsedMs).toBeLessThan(25000);
    return { ready, state, elapsedMs, parentKilled: true, overlapRefused: overlap };
  } finally { if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); await parent.exited; await removeContainer(control, name, image); }
}
