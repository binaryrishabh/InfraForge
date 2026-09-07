/* Small pure helpers for the engine: rng, rounding, burst windows,
chaos log voices, and failure voices. Zero I/O. */
import { RESOURCE_TYPES, type ResourceType } from "../constants/RESOURCE_TYPES.constants";
import { ResourceHealth, type ResourceHealthType } from "../enum/ResourceHealth.enum";
import { DeploymentChaosNames } from "../enum/DeploymentChaosNames.enum";
import { SIMULATION_CONSTANTS } from "../constants/SIMULATION_CONSTANTS.constants";
import type { WorkloadProfile } from "../interface/WorkloadProfile.interface";
import type { ChaosEffect } from "../interface/ChaosEffect.interface";
import type { ResourceMetrics } from "../interface/ResourceMetrics.interface";

export function mulberry32(seed: number) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function burstFactor(seconds: number, profile: WorkloadProfile): number {
    if (profile.trafficShape !== "peak") return 1;
    const multiplier = profile.peakMultiplier ?? 3;
    const cyclePos = seconds % SIMULATION_CONSTANTS.BURST_CYCLE_SECONDS;
    const ramp = SIMULATION_CONSTANTS.BURST_RAMP_SECONDS;
    const duration = SIMULATION_CONSTANTS.BURST_DURATION_SECONDS;
    if (cyclePos < ramp) return 1 + (multiplier - 1) * (cyclePos / ramp);
    if (cyclePos < duration - ramp) return multiplier;
    if (cyclePos < duration) return 1 + (multiplier - 1) * ((duration - cyclePos) / ramp);
    return 1;
}

export const chaosApplyMessage = (effect: ChaosEffect): string => {
    switch (effect.chaosType) {
        case DeploymentChaosNames.Crash:
            return `${effect.resourceId} crashed — process terminated, capacity removed`;
        case DeploymentChaosNames.CpuSpike:
            return `cpu spike injected on ${effect.resourceId} — runaway process detected`;
        case DeploymentChaosNames.MemoryLeak:
            return `memory leak injected on ${effect.resourceId} — heap growing unbounded`;
        case DeploymentChaosNames.NetworkDelay:
            return `network delay injected on ${effect.resourceId} — packets timing out`;
        case DeploymentChaosNames.DiskFailure:
            return `disk failure injected on ${effect.resourceId} — I/O thrashing`;
    }
};

export const failureVoice = (
    type: ResourceType | undefined,
    health: ResourceHealthType,
    metric: ResourceMetrics,
): string => {
    if (health === ResourceHealth.FAILED) {
        switch (type) {
            case RESOURCE_TYPES.VirtualMachine: return "process terminated — core dumped";
            case RESOURCE_TYPES.Database: return "server process terminated — recovery in progress";
            case RESOURCE_TYPES.Cache: return "connection reset by peer — replica out of sync";
            case RESOURCE_TYPES.LoadBalancer: return "no live upstreams — all backends unreachable";
            case RESOURCE_TYPES.ObjectStorage: return "I/O error — volume detached";
            default: return "is down";
        }
    }
    if (health === ResourceHealth.SATURATED) {
        if (metric.memory >= 97) {
            return type === RESOURCE_TYPES.VirtualMachine
                ? "Out of memory: Killed process (kernel oom-killer invoked)"
                : "memory limit exceeded — thrashing";
        }
        switch (type) {
            case RESOURCE_TYPES.Database: return "FATAL: remaining connection slots are 0 — rejecting new connections";
            case RESOURCE_TYPES.VirtualMachine: return "request queue depth critical — worker threads blocked";
            case RESOURCE_TYPES.Cache: return "maxmemory reached — aggressively evicting keys";
            case RESOURCE_TYPES.LoadBalancer: return "upstream response time exceeded — 504s climbing";
            case RESOURCE_TYPES.ObjectStorage: return "write latency spiking — throttling puts";
            default: return "saturated — requests queueing";
        }
    }
    return `utilization recovered — cpu ${metric.cpu}%`;
};