// Separate process only: exercise the actual child entrypoint, never contaminate
// other tests with filesystem or engine module doubles.
import { mock } from "bun:test";
import * as fs from "node:fs";
Object.defineProperties(process, { getuid: { value: () => 1000 }, getgid: { value: () => 1000 } });
const readFile = fs.readFileSync;
mock.module("node:fs", () => ({ ...fs, readFileSync: (path: string, ...args: any[]) => {
  if (path.startsWith("/sys/fs/cgroup/")) return "fixture";
  if (path === "/proc/self/limits" || path === "/proc/self/status") return "fixture";
  return (readFile as any)(path, ...args);
} }));
mock.module("../internalModel2/identity", () => ({ executionSource: "fixture" }));
mock.module("../firstStack/execution", () => ({ prepareFirstStackExecution: () => ({}) }));
mock.module("../firstStack/boundedExecution", () => ({ executeFirstStackBounded: () => { throw Error("Unexpected execution"); } }));
mock.module("../firstStack/isolationReplay", () => ({ replayFirstStackPrefix: async () => {
  console.error("replay invoked"); return { kind: "MatchesRecordedPrefix" };
} }));
mock.module("../firstStack/isolationSelfCheck", () => ({ isolationSelfCheck: () => {
  console.error("self-check invoked");
  if (process.argv[2] === "fail") throw Error("injected self-check failure");
} }));
try { await import("../firstStack/isolationChild"); }
catch (error) { console.error((error as Error).message); process.exit(1); }
