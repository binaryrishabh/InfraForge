import { expect, test } from "bun:test";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Resource, LbAdmission } from "@infraforge/domain/resource";
import { createModel2Run } from "@infraforge/simulation/model2-run";
import { buildContractFromRunInputs } from "@infraforge/simulation/internal-product";
import { captureRunInputs, readRunInputs } from "../deployments/runInputs";
import { LayoutSchema, LiveTopologySchema } from "../zod_schemas/layout.schema";
import { createModel2Engine } from "../simulator/model2Engine";
import { buildModel2Contract } from "../simulator/contractBuilder";
import { compareInputs } from "../comparison/inputs";

function layout(lbAdmission?: LbAdmission, resilience = false) {
  const resources: Resource[] = [
    { id: "lb", type: "Load Balancer", x: 0, y: 0, ...(lbAdmission ? { lbAdmission } : {}), ...(resilience ? {
      retry: { enabled: true, maxAttempts: 2, backoffMs: 10, jitterRatio: 0, maxConcurrentRetries: 1, retryOn: ["backendFailure"] as ["backendFailure"] },
      circuitBreaker: { enabled: true, failureThreshold: 1, cooldownMs: 100 },
    } : {}) },
    { id: "app", type: "Virtual Machine", x: 1, y: 0, size: "large" },
  ];
  return { resources, connectionLines: [{ id: "backend", sourceId: "lb", sourceType: "Load Balancer", targetId: "app", targetType: "Virtual Machine", port: 80 }] };
}
const workload = { targetThroughput: 72000, throughputUnit: "per-minute" as const, trafficShape: "steady" as const, readWriteRatio: 1, payloadSize: "light" as const };
const controls: LbAdmission[] = [{ version: 1, maxActive: 1 }, { version: 1, maxQueued: 0 }, { version: 1, queueWaitMs: 1 }, { version: 1, maxActive: 8, maxQueued: 32, queueWaitMs: 1000 }];

test("layout/live/captured schemas preserve bounded partial admission and refuse malformed intent", () => {
  for (const schema of [LayoutSchema, LiveTopologySchema]) {
    for (const setting of [{ version: 1 as const }, ...controls, { version: 1 as const, maxActive: 65536, maxQueued: 100000, queueWaitMs: 60000 }]) {
      const parsed = schema.parse(JSON.parse(JSON.stringify(layout(setting))));
      expect(parsed.resources[0]!.lbAdmission).toEqual(setting);
      expect(readRunInputs(captureRunInputs(parsed, workload, "lb-schema")).resources[0]!.lbAdmission).toEqual(setting);
    }
    for (const value of [null, [], {}, { version: 2 }, { version: 1, provider: true },
      ...[0, -1, 1.5, 65537, null, "1", NaN, Infinity].map(maxActive => ({ version: 1, maxActive })),
      ...[-1, 1.5, 100001, null, "1", NaN, Infinity].map(maxQueued => ({ version: 1, maxQueued })),
      ...[0, -1, 1.5, 60001, null, "1", NaN, Infinity].map(queueWaitMs => ({ version: 1, queueWaitMs }))]) {
      const d = layout(); Object.assign(d.resources[0]!, { lbAdmission: value });
      expect(schema.safeParse(d).success).toBe(false); expect(() => captureRunInputs(d, workload, "bad-lb")).toThrow();
    }
    const wrong = layout(); wrong.resources[1]!.lbAdmission = { version: 1, maxActive: 1 };
    expect(schema.safeParse(wrong).success).toBe(false);
  }
});

test("only new explicit admission captures select the profile; missing, duplicate and mismatched profiles refuse", () => {
  for (const setting of [undefined, { version: 1 as const }]) {
    const old = captureRunInputs(layout(setting), workload, "lb-capture"); expect(old.adapterProfiles).toEqual(["traffic-evidence/2"]);
    expect(buildContractFromRunInputs({ ...old, adapterProfiles: undefined }, 3)).toHaveProperty("contract");
    expect(buildContractFromRunInputs({ ...old, adapterProfiles: ["lb-admission/1"] }, 3)).toHaveProperty("refused");
  }
  for (const setting of controls) {
    const input = captureRunInputs(layout(setting), workload, "lb-capture"), saved = readRunInputs(JSON.parse(JSON.stringify(input)));
    expect(saved).toEqual(input); expect(saved.adapterProfiles).toEqual(["lb-admission/1", "lb-accounting/1", "traffic-evidence/2"]);
    expect(buildContractFromRunInputs(saved, 3)).toHaveProperty("contract");
    for (const adapterProfiles of [undefined, []]) expect(buildContractFromRunInputs({ ...saved, adapterProfiles }, 3)).toHaveProperty("refused");
    expect(() => readRunInputs({ ...saved, adapterProfiles: ["lb-admission/1", "lb-admission/1"] })).toThrow();
  }
});

test("browser-target and server contracts, complete evidence and live views agree every second under admission pressure", async () => {
  const browserPath = resolve(import.meta.dir, `../../../.cache/lb-admission-browser-${process.pid}.mjs`);
  await mkdir(dirname(browserPath), { recursive: true });
  try {
    const build = Bun.spawn([process.execPath, "--no-env-file", "build", resolve(import.meta.dir, "../../../packages/simulation/src/model2Run.ts"), "--target=browser", "--outfile", browserPath], { stdout: "ignore", stderr: "pipe" });
    const diagnostics = await new Response(build.stderr).text(), exitCode = await build.exited;
    if (exitCode !== 0) throw Error(`Browser build failed: ${diagnostics}`);
    const browserModule = await import(pathToFileURL(browserPath).href), createBrowserRun: typeof createModel2Run = browserModule.createModel2Run;
    for (const resilience of [false, true]) for (const setting of controls) {
      const input = readRunInputs(JSON.parse(JSON.stringify(captureRunInputs(layout(setting, resilience), workload, "lb-parity"))));
      expect(buildContractFromRunInputs(input, 3)).toEqual(buildContractFromRunInputs(input, 3, buildModel2Contract));
      const browser = createBrowserRun(input, 3), server = createModel2Engine(input, 3, buildModel2Contract);
      for (let i = 0; i < 3; i++) { browser.advance(); server.advance(); expect(browser.evidence()).toEqual(server.evidence()); expect(browser.view()).toEqual(server.view()); }
      const lb = browser.evidence().network.loadBalancers[0]!;
      expect(lb.attempts).toBeGreaterThan(0); expect(lb.active).toBeLessThanOrEqual(setting.maxActive ?? 1024);
      expect(lb.pending).toBeLessThanOrEqual(setting.maxQueued ?? 256);
    }
  } finally { if (await Bun.file(browserPath).exists()) await unlink(browserPath); }
});

test("each saved admission control stays visible as a one-change design comparison", () => {
  const base = { version: 1 as const, maxActive: 1, maxQueued: 32, queueWaitMs: 1000 };
  for (const setting of [{ ...base, maxActive: 8 }, { ...base, maxQueued: 0 }, { ...base, queueWaitMs: 1 }]) {
    const a = captureRunInputs(layout(base), workload, "same"), b = captureRunInputs(layout(setting), workload, "same");
    expect(compareInputs(a, b)).toMatchObject({ grade: "one-change-design", design: { reconfigured: [{ id: "lb", fields: [{ field: "lbAdmission" }] }] } });
  }
});
