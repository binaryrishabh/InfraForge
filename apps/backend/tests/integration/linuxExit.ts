import { readFileSync } from "node:fs";
import { constants } from "node:os";

let libc: ReturnType<typeof load> | undefined;
const load = () => {
  const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  return { library: dlopen("libc.so.6", { waitpid: { args: ["i32", "ptr", "i32"], returns: "i32" } }), ptr };
};
export function reapOwnedZombie(pid: number) {
  if (process.platform !== "linux") return null;
  let status: string;
  try { status = readFileSync(`/proc/${pid}/status`, "utf8"); } catch { return null; }
  // Never wait on an unrelated process or confuse a live/stopped child with exit.
  if (!/^State:\s+Z\b/m.test(status) || Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) !== process.pid) return null;
  libc ??= load();
  const result = new Int32Array(1);
  if (libc.library.symbols.waitpid(pid, libc.ptr(result), 1) !== pid) return null; // WNOHANG; native observer may have won.
  const bits = result[0]!, signal = bits & 127;
  if (signal === 0) return { code: (bits >> 8) & 255, signal: null };
  const name = Object.entries(constants.signals).find(([, value]) => value === signal)?.[0] as NodeJS.Signals | undefined;
  if (!name || signal === 127) throw Error("Unknown owned child wait status");
  return { code: 128 + signal, signal: name };
}
