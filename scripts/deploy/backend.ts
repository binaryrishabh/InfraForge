import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { command } from "../release/process";
import { ComposeRelease, settingsFingerprint, verifyImage } from "../release/compose";
import type { Release } from "../release/sequence";
import { fullSha } from "../release/public-check";

export async function backendState(stateDirectory: string) {
  for (const name of ["release.lock", "maintenance"]) {
    try { await lstat(resolve(stateDirectory, name)); throw new Error("Interrupted/maintenance release requires operator recovery"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  try {
    if (!(await lstat(resolve(stateDirectory, "accepted.json"))).isFile()) throw new Error("Accepted backend state must be a regular file");
    const value = JSON.parse(await readFile(resolve(stateDirectory, "accepted.json"), "utf8")) as { current?: Release };
    if (!value?.current || value.current.authContract !== 1) throw new Error("Invalid accepted backend state");
    fullSha(value.current.sha);
    return value.current;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
if (import.meta.main) {
  // A frontend-only retry can reuse acceptance, but cannot rebuild/retag its image.
  const [sha = "", envFile = "", stateDirectory = ""] = process.argv.slice(2);
  fullSha(sha);
  if (!envFile || !stateDirectory) throw new Error("Operator environment and state paths required");
  const root = process.cwd();
  if (await command(["git", "rev-parse", "HEAD"], root) !== sha || await command(["git", "status", "--porcelain"], root)) throw new Error("Clean exact checkout required");
  const accepted = await backendState(stateDirectory);
  if (accepted?.sha === sha) {
    const operations = new ComposeRelease(root, envFile, "infraforge", accepted, async () => { throw new Error("Read-only acceptance verification"); });
    if (settingsFingerprint(await operations.config()) !== accepted.settingsFingerprint) throw new Error("Accepted backend settings changed");
    await verifyImage(accepted, root);
    await operations.ready(accepted);
    console.log(`Reused already accepted backend ${sha}`);
  } else {
    const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/release.ts", "apply", sha, envFile, stateDirectory], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.exitCode = await child.exited;
  }
}
