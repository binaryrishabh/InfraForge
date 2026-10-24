import { expect, test } from "bun:test";

for (const mode of ["success", "cleanup-failure", "disk-full", "wrong-main", "active", "migration-failure", "readiness-failure", "database-start-failure", "proxy-failure"]) {
  test(`same-SHA configuration CLI preserves release gates: ${mode}`, () => {
    const child = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/tests/fixtures/reconfigure.ts", mode]);
    expect(child.exitCode).toBe(0);
    const result = JSON.parse(child.stdout.toString().trim().split(/\r?\n/).at(-1)!);
    const events = result.events as string[][];
    const starts = events.filter(args => args.includes("up") && args.includes("api"));
    expect(events.some(args => args.includes("build") || args.includes("tag"))).toBe(false);
    if (mode === "success" || mode === "cleanup-failure") {
      expect(result.failure).toBe("");
      expect(result.accepted.current.sha).toBe(result.current.sha);
      expect(result.accepted.current.image).toBe(result.current.imageId);
      expect(result.accepted.current.settingsFingerprint).not.toBe(result.current.settingsFingerprint);
      expect(result.accepted.previous).toEqual(result.current);
      expect(events.some(args => args.includes("migrate"))).toBe(true);
      expect(events.some(args => args.includes("postcheck"))).toBe(true);
      expect(events.filter(args => args.includes("health/probe.ts"))).toHaveLength(3);
      expect(starts).toHaveLength(1);
      expect(result.maintenance).toBe(false);
      expect(result.lock).toBe(false);
      expect(events.filter(args => args[1] === "image" && args[2] === "ls")).toHaveLength(1);
      expect(events.findIndex(args => args[0] === "disk-preflight")).toBeLessThan(events.findIndex(args => args[0] === "docker"));
    } else {
      expect(result.failure).toContain({ "wrong-main": "remote main", active: "active run",
        "migration-failure": "migration failed", "readiness-failure": "cannot reverse",
        "database-start-failure": "database startup failed", "proxy-failure": "did not enter maintenance", "disk-full": "disk preflight refused" }[mode]!);
      expect(events.some(args => args[1] === "image" && args[2] === "ls")).toBe(false);
      if (mode === "disk-full") expect(events.some(args => args[0] === "docker")).toBe(false);
      expect(result.accepted.current).toEqual(result.current);
      expect(starts).toHaveLength(mode === "readiness-failure" ? 1 : 0);
      const mutated = mode === "migration-failure" || mode === "readiness-failure";
      expect(result.lock).toBe(mutated || mode === "database-start-failure");
      expect(result.maintenance).toBe(mutated || mode === "proxy-failure");
      if (mode === "active" || mode === "wrong-main") expect(events.some(args => args.includes("stop"))).toBe(false);
    }
  }, 30000);
}
