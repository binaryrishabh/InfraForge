import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("rendered Compose services bound resources and logs without evicting queue keys", () => {
  const compose = Bun.YAML.parse(readFileSync("apps/backend/docker-compose.yml", "utf8")) as {
    services: Record<string, { mem_limit?: string; cpus?: number; pids_limit?: number;
      logging?: { driver: string; options: Record<string, string> }; restart?: string;
      healthcheck?: { timeout: string }; ports?: string[]; command?: string[] }>;
  };
  for (const name of ["api", "worker", "ws-server", "redis", "postgres"]) {
    const service = compose.services[name]!;
    expect(Number.parseInt(service.mem_limit!)).toBeGreaterThan(0);
    expect(service.cpus).toBeGreaterThan(0);
    expect(service.pids_limit).toBeGreaterThan(0);
    expect(service.logging?.driver).toBe("local");
    expect(service.logging?.options["max-size"]).toBe("10m");
    expect(service.logging?.options["max-file"]).toBe("3");
    expect(service.restart).toBe("unless-stopped");
    expect(service.healthcheck?.timeout).toMatch(/^[1-9][0-9]*s$/);
    for (const port of service.ports ?? []) expect(port).toStartWith("127.0.0.1:");
  }
  const command = compose.services.redis!.command!;
  expect(command[command.indexOf("--maxmemory-policy") + 1]).toBe("noeviction");
  expect(command[command.indexOf("--maxmemory") + 1]).toBe("96mb");
});


test("the 4 GiB host retains 896 MiB for host work even during the bounded build", () => {
  const { services } = Bun.YAML.parse(readFileSync("apps/backend/docker-compose.yml", "utf8")) as {
    services: Record<string, { mem_limit: string; cpus: number }>;
  };
  const names = ["api", "worker", "ws-server", "redis", "postgres"];
  const memory = names.reduce((sum, name) => sum + Number.parseInt(services[name]!.mem_limit), 0);
  const cpus = names.reduce((sum, name) => sum + services[name]!.cpus, 0);
  expect(memory).toBe(2432);
  expect(4096 - memory - 768).toBe(896);
  expect(cpus + 1).toBeCloseTo(2.75);
  expect(Number.parseInt(services.migration!.mem_limit)).toBe(256);
  // Preflight can overlap the live services; it never overlaps the build.
  expect(memory + 256 + 896).toBeLessThanOrEqual(4096);
});

test("a release builds its image with one plain docker build", async () => {
  const { buildReleaseImage } = await import("../release/build");
  const calls: string[][] = [];
  await buildReleaseImage("a".repeat(40), "owned:test", ".", async (args: string[]) => { calls.push(args); return ""; });
  expect(calls).toEqual([["docker", "build", "--build-arg", `RELEASE_SHA=${"a".repeat(40)}`, "-f", "apps/backend/Dockerfile", "-t", "owned:test", "."]]);
});
