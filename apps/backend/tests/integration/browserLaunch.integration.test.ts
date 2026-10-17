import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { launchBrowser } from "./browserLaunch";

// A closed browser must not take later children's pipes with it when its own
// children are garbage collected; the Docker supervision runs right after the
// browser proof in the same process.
const browserRun = process.env.INTEGRATION_RUN === "1" && process.env.MODEL2_BROWSER_MODULE ? test : test.skip;
browserRun("a closed browser leaves later children's pipes open", async () => {
  {
    const browser = await launchBrowser(process.env.MODEL2_BROWSER_MODULE!);
    await (await browser.newPage()).goto("about:blank");
    await browser.close();
  }
  // These take the lowest free descriptors, which include the browser's old pipes.
  const outputs = Array.from({ length: 4 }, () => new Promise<string>((resolve) => {
    const child = spawn("sh", ["-c", "sleep 1.5; echo done"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", (chunk) => { out += chunk; });
    child.once("error", (error) => resolve(error.message));
    child.once("close", () => resolve(out.trim()));
    setTimeout(() => resolve("no output or exit"), 8000);
  }));
  for (let i = 0; i < 5; i++) { Bun.gc(true); await Bun.sleep(50); }
  expect(await Promise.all(outputs)).toEqual(["done", "done", "done", "done"]);
}, 60000);
