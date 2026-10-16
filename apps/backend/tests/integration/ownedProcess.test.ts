import { expect, test } from "bun:test";
import { spawnOwned } from "./ownedProcess";
const options = { cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" } };
for (const code of [0, 7]) test(`owned subprocess observes actual exit ${code} and drains output`, async () => {
  const child = spawnOwned([process.execPath, "--no-env-file", "-e", `process.stdout.write("receipt"); process.exit(${code})`], options);
  let output = ""; for await (const chunk of child.stdout) output += chunk;
  expect(await child.exited).toBe(code); expect(child.exitCode).toBe(code); expect(child.signalCode).toBeNull(); expect(output).toBe("receipt");
});
test("repeated owned children are actually killed and reaped within the unchanged stop bound", async () => {
  for (let i = 0; i < 8; i++) {
    const child = spawnOwned([process.execPath, "--no-env-file", "-e", 'process.stdout.write("ready"); setTimeout(()=>process.exit(1),15000)'], options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>(resolve => child.stdout.once("data", () => resolve()));
      child.kill("SIGKILL");
      const code = await Promise.race([child.exited, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("Owned child did not exit within 5000ms")), 5000); })]);
      expect(code).not.toBe(0); expect(child.signalCode).toBe("SIGKILL");
      if (process.platform === "linux") expect(() => process.kill(child.pid, 0)).toThrow();
    } finally { clearTimeout(timer); child.kill("SIGKILL"); await child.exited; }
  }
});
