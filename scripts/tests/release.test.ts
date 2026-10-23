import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { releaseSequence, rollbackSequence, type Release, type ReleaseOperations } from "../release/sequence";
import { webRelease } from "../../apps/web/releaseConfig";
import { cancelCommands, command } from "../release/process";
import { applicationStopBlockers, ComposeRelease, releaseDependencyClosure } from "../release/compose";
import * as releaseProcess from "../release/process";

const release = (sha: string): Release => ({ sha, image: `image:${sha}`, imageId: sha, authContract: 1, migrationFingerprint: "same-schema", settingsFingerprint: "same-settings" });
test("shutdown inspects actual owned states and rejects paused, restarting and unknown containers", () => {
  const container = (status: string, running = false, restarting = false, service = "worker", project = "owned") => ({
    Name: `${project}-${service}-1`, Config: { Labels: { "com.docker.compose.project": project, "com.docker.compose.service": service } },
    State: { Status: status, Running: running, Restarting: restarting },
  });
  expect(applicationStopBlockers([], "owned")).toEqual([]);
  expect(applicationStopBlockers([container("exited"), container("created"), container("dead")], "owned")).toEqual([]);
  for (const state of [container("running", true), container("paused", true), container("restarting", false, true), container("removing"), container("unexpected")]) {
    expect(applicationStopBlockers([container("exited"), state], "owned")).toEqual([`${state.Name}: ${state.State.Status}`]);
  }
  expect(applicationStopBlockers([container("exited", true)], "owned")).toHaveLength(1);
  expect(() => applicationStopBlockers([container("exited", false, false, "worker", "other")], "owned")).toThrow("ownership");
  expect(() => applicationStopBlockers([container("exited", false, false, "redis")], "owned")).toThrow("ownership");
});
function fixture(failure?: string) {
  const events: string[] = [];
  const operations: ReleaseOperations = {
    preflight: async () => { events.push("preflight"); if (failure === "preflight") throw new Error("active run"); },
    stop: async () => { events.push("stop"); },
    migrate: async () => { events.push("migrate"); if (failure === "migrate") throw new Error("migration failed"); },
    postcheck: async () => { events.push("postcheck"); if (failure === "postcheck") throw new Error("drift"); },
    start: async (item) => { events.push(`start:${item.sha}`); },
    ready: async (item) => { events.push(`ready:${item.sha}`); if (failure === item.sha || failure === "all-health") throw new Error("dependency down"); },
    save: async (item) => { events.push(`save:${item.sha}`); },
  };
  return { events, operations };
}

test("release orders stop/migrate/postcheck before one start and acceptance", async () => {
  const { events, operations } = fixture();
  await releaseSequence(operations, release("new"), release("old"));
  expect(events).toEqual(["preflight", "stop", "migrate", "postcheck", "start:new", "ready:new", "save:new"]);
});
test("active runs do not get stopped and migration failures never start any worker", async () => {
  for (const failure of ["preflight", "migrate", "postcheck"]) {
    const { events, operations } = fixture(failure);
    await expect(releaseSequence(operations, release("new"), release("old"))).rejects.toThrow();
    expect(events.some((event) => event.startsWith("start"))).toBe(false);
    if (failure === "preflight") expect(events).toEqual(["preflight"]);
  }
});
test("health failure rolls back containers only when schema/auth/settings agree", async () => {
  const { events, operations } = fixture("new");
  await expect(releaseSequence(operations, release("new"), release("old"))).rejects.toThrow();
  expect(events.slice(-4)).toEqual(["ready:new", "stop", "start:old", "ready:old"]);
  for (const incompatible of [{ migrationFingerprint: "new-schema" }, { authContract: 0 }, { settingsFingerprint: "new-secret" }]) {
    const f = fixture("new");
    await expect(releaseSequence(f.operations, { ...release("new"), ...incompatible }, release("old"))).rejects.toThrow("cannot reverse");
    expect(f.events.at(-1)).toBe("stop");
  }
});
test("failed rollback leaves services stopped and never accepts it", async () => {
  const f = fixture("all-health");
  await expect(releaseSequence(f.operations, release("new"), release("old"))).rejects.toThrow("stopped");
  expect(f.events.at(-1)).toBe("stop");
  expect(f.events.some((event) => event.startsWith("save"))).toBe(false);
});
test("explicit rollback checks the database without reapplying migrations", async () => {
  const f = fixture();
  await rollbackSequence(f.operations, release("new"), release("old"));
  expect(f.events).toEqual(["preflight", "stop", "postcheck", "start:old", "ready:old", "save:old"]);
});
test("controlled frontend builds reject missing identity and insecure/mismatched endpoints", () => {
  const base = { RELEASE_BUILD: "1", RELEASE_SHA: "a".repeat(40), VITE_BACKEND_API_URL: "https://api.example.invalid/api", VITE_WS_URL: "wss://api.example.invalid/ws" };
  expect(webRelease(base)).toEqual({ sha: base.RELEASE_SHA, authContract: 1, apiURL: base.VITE_BACKEND_API_URL, wsURL: base.VITE_WS_URL });
  for (const invalid of [{ RELEASE_SHA: "development" }, { VITE_WS_URL: "ws://api.example.invalid/ws" },
    { VITE_WS_URL: "wss://another.example.invalid/ws" }, { VITE_BACKEND_API_URL: "https://api.example.invalid" },
    { VITE_WS_URL: "wss://api.example.invalid:3001/ws" }, { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }]) {
    expect(() => webRelease({ ...base, ...invalid })).toThrow();
  }
});

test("interruption cancels only command children owned by this release process", async () => {
  const running = command([process.execPath, "--no-env-file", "-e", "setTimeout(()=>{},60000)"], process.cwd())
    .then(() => undefined, (error: Error) => error);
  await cancelCommands();
  expect((await running)?.message).toContain("failed");
});

test("release image preparation covers started services and their dependencies only", () => {
  const declared = { api: { depends_on: { redis: {} } }, worker: { depends_on: { redis: {} } }, "ws-server": { depends_on: { redis: {} } },
    redis: {}, migration: { depends_on: { redis: {} } }, "pool-session": {}, edge: { depends_on: { cache: {} } }, cache: {} };
  expect([...releaseDependencyClosure(declared, ["api", "worker", "ws-server"])].sort()).toEqual(["api", "redis", "worker", "ws-server"]);
  // Transitive dependencies are followed; fixtures and unknown names are never selected.
  expect([...releaseDependencyClosure(declared, ["edge", "missing"])].sort()).toEqual(["cache", "edge"]);
  expect([...releaseDependencyClosure({ a: { depends_on: { b: {} } }, b: { depends_on: { a: {} } } }, ["a"])].sort()).toEqual(["a", "b"]);
});

for (const cached of [false, true]) test(`release ${cached ? "reuses" : "pulls"} the exact digest-pinned dependency before migration`, async () => {
  const image = readFileSync("apps/backend/docker-compose.yml", "utf8").match(/^    image: (redis:7-alpine@sha256:[a-f0-9]{64})\r?$/m)?.[1];
  expect(image).toBeDefined();
  const next = release("next"), events: string[][] = [];
  const declared = { api: { image: next.image, depends_on: { redis: {} } }, worker: { image: next.image },
    "ws-server": { image: next.image }, redis: { image }, unrelated: { image: "unrelated:fixture" } };
  const run = spyOn(releaseProcess, "command").mockImplementation(async args => {
    events.push(args);
    if (args.includes("config")) return JSON.stringify({ services: declared });
    if (args[1] === "image" && !cached) throw new Error("Pinned dependency absent");
    return "";
  });
  try {
    const operations = new ComposeRelease(process.cwd(), "fixture.env", "fixture", next, async () => {});
    await operations.preflight();
    await operations.preflight();
    expect(events.filter(args => args[1] === "image")).toEqual([["docker", "image", "inspect", image!]]);
    const pulls = events.filter(args => args.includes("pull"));
    expect(pulls.map(args => args.slice(-3))).toEqual(cached ? [] : [["pull", "--quiet", "redis"]]);
    const migrations = events.filter(args => args.includes("preflight"));
    expect(migrations).toHaveLength(2);
    expect(events.indexOf(migrations[0]!)).toBeGreaterThan(events.findIndex(args => args[1] === "image"));
    if (!cached) expect(events.indexOf(pulls[0]!)).toBeLessThan(events.indexOf(migrations[0]!));
  } finally { run.mockRestore(); }
});
