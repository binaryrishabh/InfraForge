import { createHash } from "node:crypto";

// Host containment, never a modeled infrastructure limit. Production capacity
// stays one even when an operator characterizes two disposable probe containers.
export const FIRST_STACK_ISOLATION = Object.freeze({
  schema: "first-stack-isolation/1", memoryBytes: 768 * 1024 * 1024,
  nanoCpus: 500_000_000, pids: 64, nofile: 128, cpuSeconds: 20,
  wallSeconds: 60, supervisorMs: 75_000, controlMs: 5_000,
  inputBytes: 16 * 1024 * 1024, lineBytes: 1024 * 1024 + 4096,
  outputBytes: 32 * 1024 * 1024, errorBytes: 16384, frames: 4096,
  tmpBytes: 16 * 1024 * 1024, capacity: 1,
});
export const isolationDigest = (text: string) => createHash("sha256").update(text).digest("hex");
export const isolationPolicyHash = isolationDigest(JSON.stringify(FIRST_STACK_ISOLATION));
export const executorName = "infraforge-first-stack-executor";
export const imagePattern = /^sha256:[a-f0-9]{64}$/;
export const digestPattern = /^[a-f0-9]{64}$/;
export const qualificationChecks = [
  "memory", "cpuQuota", "cpuTime", "pids", "fds", "wall", "output",
  "cancellation", "workerDeath", "databaseLoss", "revocation",
  "exclusive", "replay", "apiResponsive", "headroom", "packaging",
] as const;
export interface HostQualification {
  schema: "first-stack-host/1"; target: "laptop-desktop" | "ec2-c7i-flex.large" | "ci-linux";
  image: string; source: string; daemon: string; policy: string;
  checkedAt: string; expiresAt: string; capacity: 1; qualified: boolean;
  checks: Record<typeof qualificationChecks[number], boolean>;
}
export function assertQualified(value: HostQualification | null, identity: { image: string; source: string; daemon: string }, now = Date.now()) {
  if (!value || value.schema !== "first-stack-host/1" || value.qualified !== true ||
    !["laptop-desktop", "ec2-c7i-flex.large"].includes(value.target) ||
    value.capacity !== 1 || value.policy !== isolationPolicyHash ||
    value.image !== identity.image || value.source !== identity.source || value.daemon !== identity.daemon ||
    !imagePattern.test(value.image) || !digestPattern.test(value.source) || !digestPattern.test(value.daemon) ||
    !Number.isFinite(Date.parse(value.checkedAt)) || Date.parse(value.checkedAt) > now ||
    !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now ||
    Date.parse(value.expiresAt) - Date.parse(value.checkedAt) > 24 * 60 * 60 * 1000 ||
    qualificationChecks.some(key => value.checks?.[key] !== true)) {
    throw Error("First-stack host is unqualified, expired or changed; execution and replay disabled");
  }
}
