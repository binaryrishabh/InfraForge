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
  expect(command[command.indexOf("--maxmemory") + 1]).toBe("96mb");
});


test("the 4 GiB host retains 1280 MiB for host work even during the bounded build", () => {
  const { services } = Bun.YAML.parse(readFileSync("apps/backend/docker-compose.yml", "utf8")) as {
    services: Record<string, { mem_limit: string; cpus: number }>;
  };
  const names = ["api", "worker", "ws-server", "redis"];
  const memory = names.reduce((sum, name) => sum + Number.parseInt(services[name]!.mem_limit), 0);
  const cpus = names.reduce((sum, name) => sum + services[name]!.cpus, 0);
  expect(memory).toBe(1664);
  expect(4096 - memory - 1152).toBe(1280);
  expect(cpus + 0.5).toBeCloseTo(1.75);
  expect(Number.parseInt(services.migration!.mem_limit)).toBe(256);
  // Preflight can overlap the live services; it never overlaps the build.
  expect(memory + 256 + 1280).toBeLessThanOrEqual(4096);
});

test("a release uses a bounded isolated builder and removes it after success or build failure", async () => {
  const { buildReleaseImage } = await import("../release/build");
  for (const fail of [false, true]) {
    const calls: string[][] = [];
    const run = async (args: string[]) => {
      calls.push(args);
      if (fail && args[2] === "build") throw Error("fixture build exhausted its memory budget");
      return "";
    };
    const promise = buildReleaseImage("a".repeat(40), "owned:test", ".", run);
    if (fail) await expect(promise).rejects.toThrow("memory budget");
    else await promise;
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain("docker-container");
    expect(calls[0]).toContain("memory=1152m,memory-swap=1152m,cpu-period=100000,cpu-quota=50000");
    expect(calls[0]).not.toContain("--use");
    const name = calls[0]![4]!;
    expect(calls[1]).toEqual(["docker", "buildx", "build", "--builder", name, "--load", "--build-arg", `RELEASE_SHA=${"a".repeat(40)}`, "-f", "apps/backend/Dockerfile", "-t", "owned:test", "."]);
    expect(calls[2]).toEqual(["docker", "buildx", "rm", "--force", name]);
  }
});

test.skipIf(process.env.HARDENING_SERVICES !== "owned-local")("the real BuildKit container applies the release quotas and loads an image", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { buildReleaseImage } = await import("../release/build");
  const { command } = await import("../release/process");
  const root = await mkdtemp(join(tmpdir(), "infraforge-hardening-build-"));
  const image = `infraforge-hardening-build:${process.pid}`;
  let container = "";
  try {
    await mkdir(join(root, "apps/backend"), { recursive: true });
    await writeFile(join(root, "marker"), "owned-local\n");
    await writeFile(join(root, "apps/backend/Dockerfile"), "FROM scratch\nCOPY marker /marker\n");
    const run = async (args: string[], cwd: string) => {
      if (args[1] === "buildx" && args[2] === "build") {
        const builder = args[4]!;
        await command(["docker", "buildx", "inspect", "--bootstrap", builder], cwd);
        container = `buildx_buildkit_${builder}0`;
        const [record] = JSON.parse(await command(["docker", "inspect", container], cwd));
        expect(record.HostConfig.Memory).toBe(1152 * 1024 * 1024);
        expect(record.HostConfig.MemorySwap).toBe(record.HostConfig.Memory);
        expect(record.HostConfig.CpuQuota).toBe(50000);
        expect(record.HostConfig.CpuPeriod).toBe(100000);
      }
      return command(args, cwd);
    };
    await buildReleaseImage("b".repeat(40), image, root, run);
    expect(await command(["docker", "image", "inspect", "--format", "{{.Id}}", image], root)).toStartWith("sha256:");
    await expect(command(["docker", "inspect", container], root)).rejects.toThrow();
  } finally {
    await command(["docker", "image", "rm", image], root).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}, 180000);
