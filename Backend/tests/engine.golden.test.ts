import { describe, expect, test } from "bun:test";
import { createInitialState, tick } from "@shared/simulation/engine";
import type { SimulationState } from "@shared/simulation/engine";
import { SAMPLE_ARCHITECTURE } from "@shared/constants/SAMPLE_ARCHITECTURE.constants";
import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import { ResourceHealth } from "@shared/enum/ResourceHealth.enum";
import type { WorkloadProfile } from "@shared/types/WorkloadProfile.types";
import type { SimulationLog } from "@shared/types/SimulationLog.types";

const makeProfile = (overrides: Partial<WorkloadProfile> = {}): WorkloadProfile => ({
  targetThroughput: 1_000_000,
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

const cpuOf = (state: SimulationState, id: string) => state.metrics[id]?.cpu ?? -1;
const healthOf = (state: SimulationState, id: string) => state.metrics[id]?.health;

const withSku = (skuId: string, types: string[]) =>
  SAMPLE_ARCHITECTURE.resources.map(r => types.includes(r.type) ? { ...r, skuId } : r);

describe("golden scenarios — sample architecture", () => {
  test("S1: 500K users/hr steady stays healthy", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 500_000 }), 60);
    expect(cpuOf(final, "vm-1")).toBeGreaterThan(40);
    expect(cpuOf(final, "vm-1")).toBeLessThan(52);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.HEALTHY);
    expect(cpuOf(final, "db-1")).toBeGreaterThan(25);
    expect(cpuOf(final, "db-1")).toBeLessThan(38);
    expect(final.overallHealth).toBe("healthy");
  });

  test("S2: 2M users/hr steady saturates VMs and DB", () => {
    const { final } = simulate(makeProfile({ targetThroughput: 2_000_000 }), 60);
    expect(cpuOf(final, "vm-1")).toBeGreaterThanOrEqual(95);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.SATURATED);
    expect(cpuOf(final, "db-1")).toBeGreaterThanOrEqual(95);
    expect(final.overallHealth).toBe("saturated");
  });

  test("S3: peak shape produces real burst windows", () => {
    const { states, allLogs } = simulate(makeProfile({ targetThroughput: 500_000, trafficShape: "peak", peakMultiplier: 3 }), 127);
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
    const { final } = simulate(makeProfile({ targetThroughput: 500_000 }), 60, 42, withSku("t3.micro", [RESOURCE_TYPES.VirtualMachine]));
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
    const { final } = simulate(makeProfile({ targetThroughput: 1_600_000 }), 60, 42, withSku("s-4vcpu-8gb", [RESOURCE_TYPES.VirtualMachine]));
    expect(cpuOf(final, "vm-1")).toBeGreaterThan(70);
    expect(cpuOf(final, "vm-1")).toBeLessThan(80);
    expect(healthOf(final, "vm-1")).toBe(ResourceHealth.DEGRADED);
  });
});