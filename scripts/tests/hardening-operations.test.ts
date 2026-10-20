import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("rendered Compose services bound resources and logs without evicting queue keys", () => {
  const compose = Bun.YAML.parse(readFileSync("apps/backend/docker-compose.yml", "utf8")) as {
    services: Record<string, { mem_limit?: string; cpus?: number; pids_limit?: number;
      logging?: { driver: string; options: Record<string, string> }; restart?: string;
      healthcheck?: { timeout: string }; ports?: string[]; command?: string[] }>;
  };
  for (const name of ["api", "worker", "ws-server", "redis"]) {
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
  expect(command[command.indexOf("--maxmemory") + 1]).toBe("256mb");
});
