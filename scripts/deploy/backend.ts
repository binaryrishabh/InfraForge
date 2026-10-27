import { appendFile, readFile, lstat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { command } from "../release/process";
import { verifyLocalDocker } from "../release/docker-endpoint";
import { ComposeRelease, settingsFingerprint, verifyImage } from "../release/compose";
import type { Release } from "../release/sequence";
import { checkFrontend, fullSha, publicJSON, verifyBackend } from "../release/public-check";
const { docsOnlyChange } = require("./docs-only.cjs");

export function backendReleaseSha(requested: string, running: string, root = process.cwd()) {
  fullSha(requested); fullSha(running);
  if (running !== requested && !docsOnlyChange(running, requested, root)) {
    throw new Error("Running backend differs from the requested code; release refused");
  }
  return running;
}

// A prose-only release retains the original image identity. Public checks still
// require that exact SHA on both tiers; no image or health metadata is relabelled.
async function publicRelease(requested: string, backend: string, frontend: string) {
  const { body } = await publicJSON(`${backend}/health/ready`);
  const sha = backendReleaseSha(requested, (body as { release: { sha: string } }).release.sha);
  await verifyBackend(sha, backend);
  let reuseFrontend = false;
  if (sha !== requested) {
    try { checkFrontend(sha, backend, (await publicJSON(`${frontend}/release.json`)).body); reuseFrontend = true; }
    catch { /* A failed frontend promotion can be retried from the accepted checkout. */ }
  }
  await appendFile(process.env.GITHUB_OUTPUT!, `sha=${sha}\nreuse_frontend=${reuseFrontend}\n`);
  if (reuseFrontend) await writeFile("/tmp/infraforge-production-release.json", JSON.stringify({ requestedSha: requested, sha,
    backendOrigin: backend, frontendOrigin: frontend, publicVerified: true, reused: true }));
  console.log(`Requested ${requested}; verified backend ${sha}; reuse frontend: ${reuseFrontend}`);
}

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
  if (process.argv[2] === "--public") {
    const [, requested = "", backend = "", frontend = ""] = process.argv.slice(2);
    await publicRelease(requested, backend, frontend);
    process.exit(0);
  }
  // A frontend-only retry can reuse acceptance, but cannot rebuild/retag its image.
  const [sha = "", envFile = "", stateDirectory = ""] = process.argv.slice(2);
  fullSha(sha);
  if (!envFile || !stateDirectory) throw new Error("Operator environment and state paths required");
  const root = process.cwd();
  if (await command(["git", "rev-parse", "HEAD"], root) !== sha || await command(["git", "status", "--porcelain"], root)) throw new Error("Clean exact checkout required");
  const accepted = await backendState(stateDirectory);
  await verifyLocalDocker(root);
  if (accepted && (accepted.sha === sha || docsOnlyChange(accepted.sha, sha, root))) {
    const operations = new ComposeRelease(root, envFile, "infraforge", accepted, async () => { throw new Error("Read-only acceptance verification"); },
      undefined, 90000, process.env, resolve(stateDirectory));
    if (settingsFingerprint(await operations.config()) !== accepted.settingsFingerprint) throw new Error("Accepted backend settings changed");
    await verifyImage(accepted, root);
    await operations.ready(accepted);
    console.log(`Reused already accepted backend ${accepted.sha} for ${sha}`);
  } else {
    const child = Bun.spawn([process.execPath, "--no-env-file", "scripts/release.ts", "apply", sha, envFile, stateDirectory], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.exitCode = await child.exited;
  }
}
