import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const source = process.argv[2];
if (!source || process.argv.length !== 3) throw Error("Supply one complete M2M producer JSON");
const proof = JSON.parse(await readFile(source, "utf8")), directory = await mkdtemp(join(tmpdir(), "infraforge-m2m-negative-"));
const verify = async (path: string) => {
  const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/verify-model2-lesson-proof.ts", path], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  try {
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const code = await child.exited; await output; return code;
  } finally { clearTimeout(timer); }
};
const mutations: Record<string, (value: any) => void> = {
  "failed producer": (p) => { p.success = false; },
  "source drift": (p) => { p.source = "0".repeat(64); },
  "missing case": (p) => { p.cases = p.cases.filter((s: string) => s !== "parked lesson runner preserves Model-1 worker startup"); },
  "duplicate phase": (p) => { p.runs[1].phase = "before"; },
  "capture corruption": (p) => { p.runs[0].row.evidence.model.commands.results = []; },
  "invented report": (p) => { p.runs[0].report.lesson.returnedBytes = 0; },
  "unproved OOM": (p) => { p.os.results.memory.receipt.exit.oom = false; },
  "orphan still running": (p) => { p.os.orphan.state.Running = true; },
  "missing browser": (p) => { p.browser.executed = false; },
};
try {
  if (await verify(source) !== 0) throw Error("Negative proof checks require a valid current positive producer first");
  for (const [name, mutate] of Object.entries(mutations)) {
    const value = structuredClone(proof); mutate(value);
    const path = join(directory, "mutated.json"); await Bun.write(path, JSON.stringify(value));
    const code = await verify(path);
    if (code === 0) throw Error(`M2M proof verifier accepted ${name}`);
  }
  console.info(JSON.stringify({ refused: Object.keys(mutations), mutations: Object.keys(mutations).length }));
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir(), "infraforge-m2m-negative-"))) throw Error("Unexpected proof temporary directory");
  await rm(directory, { recursive: true });
}
