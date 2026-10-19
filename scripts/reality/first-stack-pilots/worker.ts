import { parentPort } from "node:worker_threads";
import { pbkdf2Sync } from "node:crypto";
import { dlopen, FFIType, ptr } from "bun:ffi";

// Linux CLOCK_THREAD_CPUTIME_ID. This measures only this execution thread.
const clock = dlopen("libc.so.6", { clock_gettime: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } });
const time = Buffer.alloc(16);
function threadUs() {
  if (clock.symbols.clock_gettime(3, ptr(time)) !== 0) throw Error("thread CPU clock unavailable");
  return Number(time.readBigInt64LE(0)) * 1e6 + Number(time.readBigInt64LE(8)) / 1000;
}
parentPort!.on("message", (job: { id: string; operation: string; iterations: number }) => {
  const startUs = performance.now() * 1000, cpu = threadUs();
  const checksum = job.operation === "cpu" ? pbkdf2Sync(Buffer.alloc(64, 97), Buffer.alloc(16, 98), job.iterations, 32, "sha256")[0] : null;
  parentPort!.postMessage({ id: job.id, workerStartUs: startUs, workerEndUs: performance.now() * 1000, threadCpuUs: threadUs() - cpu, checksum });
});
parentPort!.postMessage({ ready: true });
