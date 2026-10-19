import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { composeEntrypoints } from "../release/entrypoints";

const roles = { api: "api", worker: "worker", "ws-server": "ws" };
const config = () => ({ services: Object.fromEntries(Object.entries(roles).map(([service, role]) => [service,
  { working_dir: "/app/apps/backend", command: ["bun", "--no-env-file", "--no-install", "executionIdentity/launcher.ts", role] }])) });

test("Compose packaging bundles the launcher and each literal host implementation", () => {
  const launcher = readFileSync("apps/backend/executionIdentity/launcher.ts", "utf8");
  const plan = composeEntrypoints(config());
  expect(plan.map(item => item.entrypoints[1])).toEqual(["index.ts", "worker.ts", "ws-server.ts"]);
  for (const item of plan) {
    expect(item.entrypoints[0]).toBe("executionIdentity/launcher.ts");
    expect(launcher).toContain(`case "${roles[item.service as keyof typeof roles]}": await import("../${item.entrypoints[1]!.replace(/\.ts$/, "")}")`);
  }
});

test("unknown Bun flags, launcher roles, paths and working directories fail closed", () => {
  for (const edit of [(value: ReturnType<typeof config>) => value.services.api!.command.splice(2, 0, "--preload=other.ts"),
    (value: ReturnType<typeof config>) => { value.services.api!.command[4] = "worker"; },
    (value: ReturnType<typeof config>) => { value.services.api!.command[3] = "other.ts"; },
    (value: ReturnType<typeof config>) => { value.services.api!.working_dir = "/app"; }]) {
    const value = config(); edit(value); expect(() => composeEntrypoints(value)).toThrow("Unreviewed Compose execution command");
  }
});
