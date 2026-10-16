import { expect, test } from "bun:test";
import { spawnOwned } from "./ownedProcess";
import { reapOwnedZombie } from "./linuxExit";
const options = { cwd: process.cwd(), env: Object.fromEntries(["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]!])) };
for (const code of [0, 7]) test(`owned subprocess observes actual exit ${code} and drains output`, async () => {
  const child = spawnOwned([process.execPath, "--no-env-file", "-e", `process.stdout.write("receipt"); process.exit(${code})`], options);
  let output = ""; for await (const chunk of child.stdout) output += new TextDecoder().decode(chunk);
  expect(await child.exited).toBe(code); expect(child.exitCode).toBe(code); expect(child.signalCode).toBeNull(); expect(output).toBe("receipt");
});
test("repeated owned children are actually killed and reaped within the unchanged stop bound", async () => {
  for (let i = 0; i < 8; i++) {
    const child = spawnOwned([process.execPath, "--no-env-file", "-e", 'process.stdout.write("ready"); setTimeout(()=>process.exit(1),15000)'], options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await child.stdout.getReader().read();
      child.kill("SIGKILL");
      const code = await Promise.race([child.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("Owned child did not exit within 5000ms")), 5000); })]);
      expect(code).not.toBe(0); expect(child.signalCode).toBe("SIGKILL");
      if (process.platform === "linux") expect(() => process.kill(child.pid, 0)).toThrow();
    } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
  }
});
test.skipIf(process.platform !== "linux")("Linux fallback collects a real owned exit, never a live or unrelated PID", async () => {
  expect(reapOwnedZombie(process.pid)).toBeNull(); expect(reapOwnedZombie(1)).toBeNull();
  const child = Bun.spawn([process.execPath, "--no-env-file", "-e", 'process.exit(7)'], { stdout: "ignore", stderr: "ignore" });
  void child.exited.catch(() => {});
  // Let the child finish while this thread cannot dispatch Bun's native exit callback.
  Bun.sleepSync(200);
  const result = reapOwnedZombie(child.pid); child.unref();
  expect(result).toEqual({ code: 7, signal: null });
  expect(() => process.kill(child.pid, 0)).toThrow();
});
