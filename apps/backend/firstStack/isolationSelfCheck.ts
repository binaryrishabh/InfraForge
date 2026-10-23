import { closeSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

export function assertIsolationSelfCheck(value: { readonly: boolean; fdDenied: boolean; files: number;
  interfaces: string[]; before: Record<string, number>; after: Record<string, number> }) {
  if (!value.readonly || !value.fdDenied || value.files >= 128 ||
    JSON.stringify(value.interfaces) !== '["lo"]' ||
    !(value.after.nr_throttled! > value.before.nr_throttled! && value.after.throttled_usec! > value.before.throttled_usec!)) {
    throw Error("Live executor limit probe failed");
  }
}

// Only called by the canary child, inside the normal executor budget. Every
// probe is finite even when a limit is broken; no host or production writes.
export function isolationSelfCheck() {
  let readonly = false, fdDenied = false;
  const descriptors: number[] = [];
  try { writeFileSync("/app/qualification-forbidden", "canary"); }
  catch (error) { readonly = (error as NodeJS.ErrnoException).code === "EROFS"; }
  try { for (let i = 0; i < 160; i++) descriptors.push(openSync("/dev/null", "r")); }
  catch (error) { fdDenied = (error as NodeJS.ErrnoException).code === "EMFILE"; }
  finally { descriptors.forEach(closeSync); }
  const counters = () => Object.fromEntries(readFileSync("/sys/fs/cgroup/cpu.stat", "utf8").trim()
    .split("\n").map(row => { const [key, value] = row.split(/\s+/); return [key, Number(value)]; }));
  const before = counters(), began = performance.now();
  while (performance.now() - began < 4000) Math.sqrt(Math.random());
  const after = counters();
  assertIsolationSelfCheck({ readonly, fdDenied, files: descriptors.length,
    interfaces: readdirSync("/sys/class/net").sort(), before, after });
}
