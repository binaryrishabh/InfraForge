import { ChildProcess } from "node:child_process";

// Under Bun, Playwright reaches Chromium only through extra stdio pipes (fds 3 and 4).
// When Bun finalizes such an exited child it closes those descriptors a second time,
// long after Playwright closed them, so whatever had reused the numbers (a Docker
// client's pipe or pidfd, a database socket) silently lost them. A child that stays
// reachable is never finalized, so the browser's children live as long as the test.
const browserProcesses = new Set<ChildProcess>();
// spawn() starts every child through this untyped prototype method.
const prototype = ChildProcess.prototype as unknown as { spawn(this: ChildProcess, ...args: unknown[]): unknown };

export async function launchBrowser(module: string) {
  const spawn = prototype.spawn;
  prototype.spawn = function (...args) {
    browserProcesses.add(this);
    return spawn.apply(this, args);
  };
  try {
    const { chromium } = await import(module);
    return await chromium.launch({ headless: true });
  } finally { prototype.spawn = spawn; }
}
