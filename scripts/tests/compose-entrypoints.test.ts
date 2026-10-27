import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { composeEntrypoints } from "../release/entrypoints";

const hosts = { api: "index.ts", worker: "worker.ts", "ws-server": "ws-server.ts" };
const config = () => ({ services: Object.fromEntries(Object.entries(hosts).map(([service, host]) => [service,
  { working_dir: "/app/apps/backend", command: ["bun", "--no-env-file", "--no-install", host] }])) });

test("each Compose service starts exactly its own host file, as the shipped Compose file does", () => {
  expect(composeEntrypoints(config()).map((item) => item.entrypoints)).toEqual([["index.ts"], ["worker.ts"], ["ws-server.ts"]]);
  const compose = Bun.YAML.parse(readFileSync("apps/backend/docker-compose.yml", "utf8")) as { services: Record<string, { command: string[] }> };
  for (const [service, host] of Object.entries(hosts)) expect(compose.services[service]!.command).toEqual(["bun", "--no-env-file", "--no-install", host]);
});

test("unknown Bun flags, other files and working directories fail closed", () => {
  for (const edit of [(value: ReturnType<typeof config>) => value.services.api!.command.splice(2, 0, "--preload=other.ts"),
    (value: ReturnType<typeof config>) => { value.services.api!.command[3] = "worker.ts"; },
    (value: ReturnType<typeof config>) => { value.services.api!.working_dir = "/app"; }]) {
    const value = config(); edit(value); expect(() => composeEntrypoints(value)).toThrow("Unreviewed Compose execution command");
  }
});
