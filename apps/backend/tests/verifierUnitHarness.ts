import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import * as childProcess from "node:child_process";
const calls: any[][] = [];
let failed = false, uid = 1001;
Object.defineProperties(process, { platform: { value: "linux" }, getuid: { value: () => uid } });
mock.module("node:child_process", () => ({ ...childProcess, spawn: () => { throw Error("No Docker process allowed"); },
  execFile: (file: string, args: string[], options: unknown, callback: any) => {
    calls.push([file, args, options]); callback(failed ? Error("private runtime failure") : null, "ControlGroup=fixture");
  } }));
const { readVerifierUnit } = await import("../firstStack/isolationConnection");
assert.equal(await readVerifierUnit("supervisor"), "ControlGroup=fixture");
assert.equal(await readVerifierUnit("manager"), "ControlGroup=fixture");
assert.equal(calls[0]![0], "/usr/bin/systemctl");
assert.equal(calls[0]![1][0], "show"); assert.equal(calls[0]![1][1], "first-stack-verifier.service");
assert.ok(calls[0]![1][2].startsWith("--property=ControlGroup,User,Group,MemoryMax,"));
assert.deepEqual(calls[1]![1], ["show", "user@1001.service", "--property=ControlGroup"]);
for (const call of calls) assert.deepEqual(call[2], { timeout: 2000, maxBuffer: 65536, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
failed = true; await assert.rejects(readVerifierUnit("supervisor"), { message: "Effective systemd policy unavailable" });
const count = calls.length;
await assert.rejects(readVerifierUnit("other.service" as any));
uid = 0; await assert.rejects(readVerifierUnit("manager"));
assert.equal(calls.length, count);
console.log("Fixed bounded systemd observation passed");
