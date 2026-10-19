import { expect } from "bun:test";
import { join } from "node:path";
import { runSandbox } from "../../internalModel2/sandboxRunner";
import type { SandboxReceipt } from "../../internalModel2/sandboxRunner";
import { DockerConnection } from "../../internalModel2/dockerConnection";
import { checkOrphanDeadline } from "./lessonOrphanChecks";
import { withFixtureImage } from "./lessonFixtureImage";
// This probe replaces the entrypoint in a disposable test image only.
export const fixture = `import { sandboxReady } from './sandboxHandshake';
import { createInterface } from 'node:readline';
import { openSync, writeFileSync } from 'node:fs';
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const request=JSON.parse((await lines.next()).value);
const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
send(sandboxReady());
if(request.fixture==='cpu') { while(true) Math.sqrt(Math.random()); }
if(request.fixture==='memory') { const blocks=[]; while(true) blocks.push(new Uint8Array(64*1024*1024).fill(7)); }
if(request.fixture==='wall') { await Bun.sleep(60000); }
if(request.fixture==='oversized') { process.stdout.write('x'.repeat(270337)); await Bun.sleep(60000); }
if(request.fixture==='malformed') { process.stdout.write('{invalid}\\n'); await Bun.sleep(60000); }
if(request.fixture==='pids') {
 const children=[]; let denied=false;
 try{for(let i=0;i<128;i++)children.push(Bun.spawn(['/bin/sleep','60'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}))}catch(e){denied=/EAGAIN|temporarily unavailable/i.test(String(e))}
 const count=children.length; for(const child of children)child.kill('SIGKILL'); await Promise.all(children.map(c=>c.exited));
 send({kind:'controls',value:{denied,count}});send({kind:'done'});process.exit(0);
}
if(request.fixture==='controls') {
 let readonly=false,network=false,files=0; try{writeFileSync('/app/forbidden','x')}catch(e){readonly=e.code==='EROFS'}
 try{await fetch('https://1.1.1.1',{signal:AbortSignal.timeout(1000)})}catch{network=true}
 try{while(true){openSync('/tmp/file-'+files,'w');files++}}catch(e){if(e.code!=='EMFILE')throw e}
 send({kind:'controls',value:{readonly,network,files}}); send({kind:'done'});process.exit(0);
}
`;
// A failed phase used to leave only the assertion text. Keep the phase results and
// what the daemon recorded for the window, whether the checks pass or not.
async function keepSandboxEvidence(control: DockerConnection, output: string, evidence: Record<string, unknown>, since: number) {
  const records = (text: string) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  try {
    evidence.events = records(await control.run(["events", "--since", String(Math.floor(since / 1000)), "--until", String(Math.ceil(Date.now() / 1000)), "--filter", "type=container",
      ...["create", "attach", "start", "kill", "oom", "die", "stop", "destroy"].flatMap((event) => ["--filter", `event=${event}`]), "--format", "{{json .}}"], 262144));
    evidence.containers = records(await control.run(["ps", "--all", "--no-trunc", "--format",
      '{"id":{{json .ID}},"name":{{json .Names}},"image":{{json .Image}},"state":{{json .State}},"status":{{json .Status}},"labels":{{json .Labels}}}'], 262144));
  } catch (error) { evidence.daemonError = error instanceof Error ? error.message : String(error); }
  await Bun.write(join(output, "sandbox-evidence.json"), JSON.stringify(evidence, null, 2)).catch(() => { /* Diagnostics never replace the check's own result. */ });
}
export async function checkLessonSandbox(baseImage: string, output: string) {
  return DockerConnection.use(async (control) => {
  return withFixtureImage(control, baseImage, join(output, "fixture"), fixture, async (image, fixtureSource) => {
    const results: Record<string, any> = {}, phases: Array<Record<string, unknown>> = [], since = Date.now();
    const evidence: Record<string, unknown> = { image, connection: control.receipt, results, phases };
    try {
    for (const kind of ["controls", "pids", "cpu", "memory", "wall", "oversized", "malformed"]) {
      console.info(`M2M sandbox phase: ${kind}`);
      let receipt: SandboxReceipt | undefined, failure = "", value: unknown; const start = Date.now(), clock = performance.now();
      const id = crypto.randomUUID();
      try { await runSandbox(control, id, image, { fixture: kind }, async (frame) => { if (frame.kind !== "controls") throw Error("Unexpected fixture frame"); value = frame.value; }, async (r) => { receipt = structuredClone(r); }, undefined, id, fixtureSource); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); }
      results[kind] = { elapsedMs: Date.now() - start, receipt, failure, value };
      // Wall-clock and monotonic time separately, so a clock step cannot pass as a short phase.
      phases.push({ kind, startedAt: new Date(start).toISOString(), endedAt: new Date().toISOString(), monotonicMs: performance.now() - clock });
      if (kind === "controls") { expect(failure).toBe(""); expect(value).toMatchObject({ readonly: true, network: true }); expect((value as any).files).toBeLessThan(128); }
      else if (kind === "pids") { expect(failure).toBe(""); expect((value as any).denied).toBe(true); expect((value as any).count).toBeGreaterThan(0); expect((value as any).count).toBeLessThan(64); }
      else expect(failure.length).toBeGreaterThan(0);
      if (kind === "cpu") { expect(receipt?.exit?.oom).toBe(false); expect(receipt?.exit?.code).not.toBe(0); expect(results[kind].elapsedMs).toBeLessThan(15000); }
      if (kind === "memory") expect(receipt?.exit?.oom).toBe(true);
      if (kind === "wall") { expect(receipt?.exit?.code).not.toBe(0); expect(results[kind].elapsedMs).toBeGreaterThanOrEqual(14000); expect(results[kind].elapsedMs).toBeLessThan(25000); }
      if (kind === "oversized") expect(failure).toContain("line budget");
      if (kind === "malformed") expect(failure).toMatch(/JSON|parse|Expected/i);
    }
    console.info("M2M sandbox phase: orphan deadline");
    const orphan = await checkOrphanDeadline(control, image, output, fixtureSource);
    await keepSandboxEvidence(control, output, evidence, since);
    return { image, baseImage, connection: control.receipt, results, orphan };
    } catch (error) {
      evidence.failure = error instanceof Error ? error.message : String(error);
      await keepSandboxEvidence(control, output, evidence, since);
      throw error;
    }
  });
  });
}
