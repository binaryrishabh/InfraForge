import { describe, expect, test } from "bun:test";
import { createInitialState, tick, applyManualScale } from "@shared/simulation/engine";
import { DeploymentChaosNames } from "@shared/enum/DeploymentChaosNames.enum";
import { SAMPLE_ARCHITECTURE } from "@shared/constants/SAMPLE_ARCHITECTURE.constants";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import type { SimulationState } from "@shared/interface/SimulationState.interface";
import type { ChaosEffect } from "@shared/interface/ChaosEffect.interface";
import type { TickInputs } from "@shared/interface/TickInputs.interface";
import type { WorkloadProfile } from "@shared/interface/WorkloadProfile.interface";
import type { SimulationLog } from "@shared/interface/SimulationLog.interface";
import type { VerticalScaleAction } from "@shared/interface/VerticalScaleAction.interface";

const makeProfile = (overrides: Partial<WorkloadProfile> = {}): WorkloadProfile => ({
  targetThroughput: 1000000,
  throughputUnit: "per-hour",
  trafficShape: "steady",
  readWriteRatio: 0.8,
  payloadSize: "medium",
  ...overrides
});

function simulate(profile: WorkloadProfile, totalTicks: number, seed = 42, resources = SAMPLE_ARCHITECTURE.resources) {
  let state = createInitialState("golden-test", resources, SAMPLE_ARCHITECTURE.connectionLines, profile, seed);
  const allLogs: SimulationLog[] = [];
  const states: SimulationState[] = [];
  for (let i = 0; i < totalTicks; i++) {
    const result = tick(state, {});
    state = result.state;
    allLogs.push(...result.logs);
    states.push(state);
  }
  return { states, allLogs, final: state };
}

function simulateWithChaos(
  profile: WorkloadProfile,
  totalTicks: number,
  chaos: ChaosEffect,
  injectAtTick: number,
  seed = 42,
  resources = SAMPLE_ARCHITECTURE.resources
) {
  let state = createInitialState("golden-test", resources, SAMPLE_ARCHITECTURE.connectionLines, profile, seed);
  const allLogs: SimulationLog[] = [];
  const states: SimulationState[] = [];
  for (let i = 0; i < totalTicks; i++) {
    if (i === injectAtTick) {
      state.activeChaos.push(chaos);
    }
    const result = tick(state, {});
    state = result.state;
    allLogs.push(...result.logs);
    states.push(state);
  }
  return { states, allLogs, final: state };
}

function simulateWithInputs(
  profile: WorkloadProfile,
  totalTicks: number,
  inputAtTick: Record<number, TickInputs>,
  seed = 42,
  resources = SAMPLE_ARCHITECTURE.resources
) {
  let state = createInitialState("golden-test", resources, SAMPLE_ARCHITECTURE.connectionLines, profile, seed);
  const allLogs: SimulationLog[] = [];
  const states: SimulationState[] = [];
  for (let i = 0; i < totalTicks; i++) {
    const result = tick(state, inputAtTick[i] ?? {});
    state = result.state;
    allLogs.push(...result.logs);
    states.push(state);
  }
  return { states, allLogs, final: state };
}

function simulateWithVerticalScale(
  profile: WorkloadProfile,
  totalTicks: number,
  action: VerticalScaleAction,
  injectAtTick: number,
  seed = 42,
  resources = SAMPLE_ARCHITECTURE.resources
) {
  let state = createInitialState("golden-test", resources, SAMPLE_ARCHITECTURE.connectionLines, profile, seed);
  const allLogs: SimulationLog[] = [];
  const states: SimulationState[] = [];
  for (let i = 0; i < totalTicks; i++) {
    if (i === injectAtTick) {
      state.verticalScaling.push(action);
    }
    const result = tick(state, {});
    state = result.state;
    allLogs.push(...result.logs);
    states.push(state);
  }
  return { states, allLogs, final: state };
}

const activeReplicas = (s: SimulationState, lbId: string) => {
  const pool = s.pools[lbId];
  if (!pool) return 0;
  return pool.baseVmIds.length + s.spawnedVms.filter(v => v.poolId === lbId && v.status === "active").length;
};

const cpuOf = (state: SimulationState, id: string) => state.metrics[id]?.cpu ?? -1;
const healthOf = (state: SimulationState, id: string) => state.metrics[id]?.health;

const withSku = (skuId: string, types: string[]) =>
  SAMPLE_ARCHITECTURE.resources.map(r => types.includes(r.type) ? { ...r, skuId } : r);

describe("golden scenarios — sample architecture", () => {
  test("S1: 500K users/hr steady stays healthy", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500000 }), 60);
    expect(cpuOf(final, "vm-1")).toBeGreaterThan(40);
    expect(cpuOf(final, "vm-1")).toBeLessThan(52);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.HEALTHY);
    expect(cpuOf(final, "db-1")).toBeGreaterThan(25);
    expect(cpuOf(final, "db-1")).toBeLessThan(38);
    expect(final.overallHealth).toBe("healthy");
  });

  test("S2: 2M users/hr steady saturates VMs and DB", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 2000000 }), 60);
    expect(cpuOf(final, "vm-1")).toBeGreaterThanOrEqual(95);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.SATURATED);
    expect(cpuOf(final, "db-1")).toBeGreaterThanOrEqual(95);
    expect(final.overallHealth).toBe("saturated");
  });

  test("S3: peak shape produces real burst windows", () => {
    const { states, allLogs } = simulate(makeProfile({ targetThroughput: 500000, trafficShape: "peak", peakMultiplier: 3 }), 127);
    const base = states[109]!;
    const burst = states[126]!;
    expect(cpuOf(base, "vm-1")).toBeLessThan(60);
    expect(cpuOf(burst, "vm-1")).toBeGreaterThanOrEqual(95);
    expect(allLogs.some(l => l.message.includes("burst beginning"))).toBe(true);
  });

  test("S4: write-heavy mix hammers the database", () => {
    const writeHeavy = simulate(makeProfile({ readWriteRatio: 0.5 }), 60).final;
    const readHeavy = simulate(makeProfile({ readWriteRatio: 0.95 }), 60).final;
    expect(cpuOf(writeHeavy, "db-1")).toBeGreaterThanOrEqual(95);
    expect(healthOf(writeHeavy, "db-1")).toBe(ResourceHealth.SATURATED);
    expect(cpuOf(readHeavy, "db-1")).toBeLessThan(45);
    expect(healthOf(readHeavy, "db-1")).toBe(ResourceHealth.HEALTHY);
  });

  test("S5: heavy payload saturates the load balancer through bandwidth", () => {
    const heavy = simulate(makeProfile({ payloadSize: "heavy" }), 60).final;
    const medium = simulate(makeProfile({ payloadSize: "medium" }), 60).final;
    expect(cpuOf(heavy, "lb-1")).toBeGreaterThanOrEqual(95);
    expect(healthOf(heavy, "lb-1")).toBe(ResourceHealth.SATURATED);
    expect(cpuOf(medium, "lb-1")).toBeLessThan(20);
  });

  test("S6: structural logs fire on the first tick", () => {
    const { allLogs } = simulate(makeProfile(), 1);
    expect(allLogs.some(l => l.message.includes("simulation started"))).toBe(true);
    expect(allLogs.some(l => l.resourceId === "vm-2" && l.message.includes("no downstream data path"))).toBe(true);
  });

  test("S7: undersized t3.micro VMs saturate under modest load", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500000 }), 60, 42, withSku("t3.micro", [RESOURCE_TYPES.VirtualMachine]));
    expect(cpuOf(final, "vm-1")).toBeGreaterThanOrEqual(95);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.SATURATED);
  });

  test("S8: db.m5.xlarge absorbs the write-heavy load that crushed the generic DB", () => {
    const { final } = simulate(makeProfile({ readWriteRatio: 0.5 }), 60, 42, withSku("db.m5.xlarge", [RESOURCE_TYPES.Database]));
    expect(cpuOf(final, "db-1")).toBeGreaterThan(50);
    expect(cpuOf(final, "db-1")).toBeLessThan(70);
    expect(healthOf(final, "db-1")).toBe(ResourceHealth.HEALTHY);
  });

  test("S9: DigitalOcean s-4vcpu-8gb degrades but survives 1.6M users/hr", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 1_600000 }), 60, 42, withSku("s-4vcpu-8gb", [RESOURCE_TYPES.VirtualMachine]));
    expect(cpuOf(final, "vm-1")).toBeGreaterThan(70);
    expect(cpuOf(final, "vm-1")).toBeLessThan(80);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.DEGRADED);
  });
});

describe("golden scenarios — chaos", () => {
  test("C1: crash kills a VM and redistributes its load", () => {
    const chaos: ChaosEffect = {
      chaosType: DeploymentChaosNames.Crash,
      resourceId: "vm-1",
      durationTicks: 30,
      remainingTicks: 30
    };
    const { states } = simulateWithChaos(makeProfile({ targetThroughput: 1000000 }), 95, chaos, 60);
    const state65 = states[64]!;
    expect(healthOf(state65, "vm-1")).toBe(ResourceHealth.FAILED);
    expect(cpuOf(state65, "vm-1")).toBe(0);
    expect(cpuOf(state65, "vm-2")).toBeGreaterThan(cpuOf(state65, "vm-1"));
    const state95 = states[94]!;
    expect(healthOf(state95, "vm-1")).not.toBe(ResourceHealth.FAILED);
  });

  test("C2: cpu-spike pushes a healthy VM into degraded or saturated", () => {
    const chaos: ChaosEffect = {
      chaosType: DeploymentChaosNames.CpuSpike,
      resourceId: "vm-1",
      durationTicks: 20,
      remainingTicks: 20
    };
    const { states } = simulateWithChaos(makeProfile({ targetThroughput: 500000 }), 62, chaos, 60);
    const state62 = states[61]!;
    expect(cpuOf(state62, "vm-1")).toBeGreaterThanOrEqual(85);
    const health = healthOf(state62, "vm-1");
    expect(health === ResourceHealth.DEGRADED || health === ResourceHealth.SATURATED).toBe(true);
  });

  test("C3: memory-leak eventually saturates via memory", () => {
    const chaos: ChaosEffect = {
      chaosType: DeploymentChaosNames.MemoryLeak,
      resourceId: "vm-1",
      durationTicks: 40,
      remainingTicks: 40
    };
    const { states } = simulateWithChaos(makeProfile({ targetThroughput: 500000 }), 95, chaos, 60);
    const state95 = states[94]!;
    expect(state95.metrics["vm-1"]!.memory).toBeGreaterThanOrEqual(90);
  });
});

describe("golden scenarios — autoscaling", () => {
  test("S10: autoscaler rescues a saturating pool", () => {
    const { states, allLogs, final } = simulate(makeProfile({ targetThroughput: 1_000_000 }), 150);
    const before = states[59]!;
    expect(cpuOf(before, "vm-1")).toBeGreaterThanOrEqual(85);
    expect(activeReplicas(final, "lb-1")).toBe(3);
    expect(final.spawnedVms.filter(v => v.status === "active").length).toBe(1);
    expect(cpuOf(final, "vm-1")).toBeGreaterThan(50);
    expect(cpuOf(final, "vm-1")).toBeLessThan(70);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.HEALTHY);
    expect(allLogs.some(l => l.source === "autoscaler" && l.message.includes("provisioning"))).toBe(true);
  });

  test("S11: autoscaler respects maxReplicas under relentless load", () => {
    const resources = SAMPLE_ARCHITECTURE.resources.map(r =>
      r.id === "lb-1" ? { ...r, autoscaling: { minReplicas: 2, maxReplicas: 3, targetCpu: 75 } } : r
    );
    const { final } = simulate(makeProfile({ targetThroughput: 3_000_000 }), 250, 42, resources);
    expect(activeReplicas(final, "lb-1")).toBe(3);
    expect(final.spawnedVms.length).toBe(1);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.SATURATED);
  });

  test("S12: cold pool scales back down to base replicas", () => {
    const { final } = simulateWithInputs(makeProfile({ targetThroughput: 1_000_000 }), 300, { 160: { targetLoadFraction: 0.3 } });
    expect(activeReplicas(final, "lb-1")).toBe(2);
    expect(final.spawnedVms.filter(v => v.status === "active").length).toBe(0);
  });
});

describe("golden scenarios — vertical scaling", () => {
  test("V1: vertical swap takes the resource offline then brings it back", () => {
    const action: VerticalScaleAction = {
      resourceId: "vm-1",
      toSkuId: "m5.large",
      downtimeTicks: 20,
      remainingTicks: 20
    };
    const { states } = simulateWithVerticalScale(
      makeProfile({ targetThroughput: 1_000_000 }),
      100,
      action,
      60,
      42,
      withSku("t3.micro", [RESOURCE_TYPES.VirtualMachine])
    );
    const state70 = states[69]!;
    expect(healthOf(state70, "vm-1")).toBe(ResourceHealth.FAILED);
    expect(cpuOf(state70, "vm-1")).toBe(0);
    const state95 = states[94]!;
    expect(healthOf(state95, "vm-1")).not.toBe(ResourceHealth.FAILED);
  });

  test("V2: scaled-up VM survives load that crushed the small SKU", () => {
    const action: VerticalScaleAction = {
      resourceId: "vm-1",
      toSkuId: "m5.large",
      downtimeTicks: 20,
      remainingTicks: 20
    };
    const { final } = simulateWithVerticalScale(
      makeProfile({ targetThroughput: 1_200_000 }),
      150,
      action,
      60,
      42,
      withSku("t3.micro", [RESOURCE_TYPES.VirtualMachine])
    );
    const health = healthOf(final, "vm-1");
    expect(health === ResourceHealth.HEALTHY || health === ResourceHealth.DEGRADED).toBe(true);
    expect(final.resourceSkus["vm-1"]!.skuId).toBe("m5.large");
  });
});

describe("golden scenarios — manual scaling", () => {
  test("M1: manual scale-up provisions a new replica into the pool", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500_000 }), 60);
    const result = applyManualScale(final, "lb-1", 1);
    expect(result.log.message.includes("manual scale-up")).toBe(true);
    expect(result.state.pools["lb-1"]!.pending?.action).toBe("up");
    expect(result.state.spawnedVms.filter(v => v.status === "provisioning").length).toBe(1);
    let state = result.state;
    for (let i = 0; i < 80; i++) state = tick(state, {}).state;
    expect(activeReplicas(state, "lb-1")).toBe(3);
    expect(state.spawnedVms.filter(v => v.status === "active").length).toBe(1);
  });

  test("M2: manual scale-down drains a spawned replica and protects the base", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500_000 }), 60);
    let state = applyManualScale(final, "lb-1", 1).state;
    for (let i = 0; i < 80; i++) state = tick(state, {}).state;
    expect(activeReplicas(state, "lb-1")).toBe(3);
    const drained = applyManualScale(state, "lb-1", -1);
    expect(drained.log.message.includes("manual scale-down")).toBe(true);
    state = drained.state;
    for (let i = 0; i < 20; i++) state = tick(state, {}).state;
    expect(activeReplicas(state, "lb-1")).toBe(2);
    expect(state.spawnedVms.filter(v => v.status === "active").length).toBe(0);
  });

  test("M3: manual scale refuses when capped or protecting base replicas", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500_000 }), 60);
    const noSpawned = applyManualScale(final, "lb-1", -1);
    expect(noSpawned.log.message.includes("protected")).toBe(true);
    expect(noSpawned.state.spawnedVms.length).toBe(0);
    expect(noSpawned.state.pools["lb-1"]!.pending).toBe(null);
    const cappedResources = SAMPLE_ARCHITECTURE.resources.map(r =>
      r.id === "lb-1" ? { ...r, autoscaling: { minReplicas: 2, maxReplicas: 2, targetCpu: 75 } } : r
    );
    const cappedState = createInitialState("golden-test", cappedResources, SAMPLE_ARCHITECTURE.connectionLines, makeProfile({ targetThroughput: 500_000 }), 42);
    const refused = applyManualScale(cappedState, "lb-1", 1);
    expect(refused.log.message.includes("max replicas")).toBe(true);
    expect(refused.state.spawnedVms.length).toBe(0);
  });
});

describe("golden scenarios — cascading failures", () => {
  test("X1: cache crash stampedes the database", () => {
    const chaos: ChaosEffect = { chaosType: DeploymentChaosNames.Crash, resourceId: "cache-1", durationTicks: 30, remainingTicks: 30 };
    const { states } = simulateWithChaos(makeProfile({ targetThroughput: 1_000_000 }), 70, chaos, 60);
    const state65 = states[64]!;
    expect(healthOf(state65, "db-1")).toBe(ResourceHealth.SATURATED);
    expect(cpuOf(state65, "db-1")).toBeGreaterThanOrEqual(95);
  });

  test("X2: cache crash stresses the dependent VM into saturation", () => {
    const chaos: ChaosEffect = { chaosType: DeploymentChaosNames.Crash, resourceId: "cache-1", durationTicks: 30, remainingTicks: 30 };
    const { states } = simulateWithChaos(makeProfile({ targetThroughput: 700_000 }), 70, chaos, 60);
    const before = states[58]!;
    expect(healthOf(before, "vm-1")).not.toBe(ResourceHealth.SATURATED);
    const after = states[64]!;
    expect(healthOf(after, "vm-1")).toBe(ResourceHealth.SATURATED);
  });

  test("X3: load balancer sheds 502s when a backend VM dies", () => {
    const chaos: ChaosEffect = { chaosType: DeploymentChaosNames.Crash, resourceId: "vm-1", durationTicks: 30, remainingTicks: 30 };
    const { allLogs } = simulateWithChaos(makeProfile({ targetThroughput: 500_000 }), 70, chaos, 60);
    expect(allLogs.some(l => l.message.includes("shedding 502s"))).toBe(true);
  });
});