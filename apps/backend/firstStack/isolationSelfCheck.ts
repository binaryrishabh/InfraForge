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
const nativeProbe = { write: () => writeFileSync("/app/qualification-forbidden", "canary"),
  open: () => openSync("/dev/null", "r"), close: closeSync,
  counters: () => readFileSync("/sys/fs/cgroup/cpu.stat", "utf8"),
  interfaces: () => readdirSync("/sys/class/net"), now: () => performance.now(),
  work: () => { Math.sqrt(Math.random()); } };
export function isolationSelfCheck(probe = nativeProbe) {
  let readonly = false, fdDenied = false;
  const descriptors: number[] = [];
  try { probe.write(); }
  catch (error) { readonly = (error as NodeJS.ErrnoException).code === "EROFS"; }
  try { for (let i = 0; i < 160; i++) descriptors.push(probe.open()); }
  catch (error) { fdDenied = (error as NodeJS.ErrnoException).code === "EMFILE"; }
  finally { descriptors.forEach(fd => probe.close(fd)); }
  const counters = () => Object.fromEntries(probe.counters().trim()
    .split("\n").map(row => { const [key, value] = row.split(/\s+/); return [key, Number(value)]; }));
  const before = counters(), began = probe.now();
  while (probe.now() - began < 4000) probe.work();
  const after = counters();
  assertIsolationSelfCheck({ readonly, fdDenied, files: descriptors.length,
    interfaces: probe.interfaces().sort(), before, after });
}
