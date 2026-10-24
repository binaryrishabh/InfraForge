import { cleanupReleaseBuilder } from "./release/build";
import { mkdir, readFile, rename, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ComposeRelease, settingsFingerprint } from "./release/compose";
import { cancelCommands, command } from "./release/process";
import { releaseSequence, rollbackSequence, type Release } from "./release/sequence";
import { prepareReleaseImage, type AcceptedState, type ReleaseAction } from "./release/image";
import { preflightReleaseSpace, pruneAcceptedImages } from "./release/hygiene";

const root = fileURLToPath(new URL("../", import.meta.url));
const [action, sha, environmentFile, stateDirectory] = process.argv.slice(2);
if (!["apply", "reconfigure", "rollback"].includes(action ?? "") || !sha || !/^[a-f0-9]{40}$/.test(sha) || !environmentFile || !stateDirectory) {
  throw new Error("Use: bun --no-env-file scripts/release.ts apply|reconfigure|rollback <full-sha> <operator-env-file> <state-directory>");
}
if (await command(["git", "rev-parse", "HEAD"], root) !== sha || await command(["git", "status", "--porcelain"], root)) {
  throw new Error("Release requires a clean checkout at the exact approved SHA");
}
if (action !== "rollback") {
  const main = (await command(["git", "ls-remote", "origin", "refs/heads/main"], root)).split(/\s+/)[0];
  if (main !== sha) throw new Error("Release checkout must match remote main; this command never promotes develop");
}
const directory = resolve(stateDirectory);
await preflightReleaseSpace(root, directory);
// Nginx must be able to stat the maintenance marker; state files stay private.
await mkdir(directory, { recursive: true, mode: 0o711 });
const lockPath = resolve(directory, "release.lock");
const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Another release or interrupted release owns release.lock; inspect before removing it"); });
await lock.writeFile(JSON.stringify({ pid: process.pid, sha, action, startedAt: new Date().toISOString() }));
let interrupted = false;
let operationsInProgress: ComposeRelease | undefined;
let mutationStarted = false;
let failedAfterStop = false;
const interrupt = async () => {
  if (interrupted) return;
  interrupted = true;
  await cancelCommands();
  await cleanupReleaseBuilder(command, root);
  if (mutationStarted && operationsInProgress) {
    await operationsInProgress.compose(["stop", "--timeout", "30", "api", "worker", "ws-server"]).catch(() => {});
    await operationsInProgress.stopMigration().catch(() => {});
  }
  console.error("Interrupted release. release.lock remains; inspect maintenance, services and migration history before recovery.");
  process.exit(1);
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  let state: AcceptedState | undefined;
  try { state = JSON.parse(await readFile(resolve(directory, "accepted.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const next = await prepareReleaseImage(action as ReleaseAction, sha, state, root);
  const save = async (current: Release, previous?: Release) => {
    const temporary = resolve(directory, "accepted.json.tmp");
    const file = await open(temporary, "w", 0o600);
    try { await file.writeFile(JSON.stringify({ current, previous }, null, 2)); }
    finally { await file.close(); }
    await rename(temporary, resolve(directory, "accepted.json"));
  };
  const operations = new ComposeRelease(root, resolve(environmentFile), "infraforge", next, save, undefined, 90000, process.env, directory);
  operationsInProgress = operations;
  operations.onMutation = () => { mutationStarted = true; };
  const stop = operations.stop.bind(operations);
  operations.stop = async () => { mutationStarted = true; await stop(); };
  const configuration = await operations.config();
  next.settingsFingerprint = settingsFingerprint(configuration);
  const origin = configuration.services.api.environment.BETTER_AUTH_URL as string;
  if (new URL(origin).protocol !== "https:") throw new Error("Release requires a public HTTPS proxy");
  await operations.preflight();
  const maintenance = resolve(directory, "maintenance");
  await Bun.write(maintenance, `${sha}\n`);
  for (const path of ["/api/auth/providers", "/ws"]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (response.status !== 503 || response.headers.get("X-InfraForge-Maintenance") !== "true") {
      throw new Error("Public TLS proxy did not enter maintenance; retire old services and install the release proxy configuration");
    }
  }
  const internalReady = operations.ready.bind(operations);
  operations.ready = async (release) => {
    await internalReady(release);
    const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(10000), redirect: "error" });
    const result = await response.json() as { success?: boolean; release?: { sha?: string } };
    if (!response.ok || !result.success || result.release?.sha !== release.sha) throw new Error("Public TLS proxy release identity/readiness failed");
  };
  if (action !== "rollback") {
    await operations.compose(["up", "-d", "--pull", "never", "redis"]);
    await releaseSequence(operations, next, state?.current);
  } else {
    if (!state?.previous || state.current.sha !== sha || state.current.settingsFingerprint !== next.settingsFingerprint) {
      throw new Error("No accepted previous release, wrong current SHA or changed settings; rollback refused");
    }
    await rollbackSequence(operations, state.current, state.previous);
  }
  await unlink(maintenance);
  console.log(`Accepted ${action !== "rollback" ? sha : state!.previous!.sha}; verify public TLS/WS/auth before frontend promotion.`);
  // Cleanup is post-acceptance housekeeping. Its failure cannot undo acceptance
  // or cause the controller to treat healthy services as a failed release.
  try { await pruneAcceptedImages(root, directory); }
  catch (error) { console.error(`Accepted release cleanup incomplete: ${(error as Error).message}`); }
} catch (error) {
  failedAfterStop = mutationStarted;
  if (failedAfterStop && operationsInProgress) await operationsInProgress.stopMigration().catch(() => {});
  throw error;
} finally {
  await lock.close();
  if (!interrupted && !failedAfterStop) await unlink(lockPath);
}
