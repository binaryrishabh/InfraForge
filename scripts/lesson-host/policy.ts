export type Status = "VERIFIED" | "FAILED" | "UNKNOWN" | "NOT_APPLICABLE";
export interface Observation { status: Status; basis: "observed" | "configured" | "enforced" | "unknown"; detail: string; evidence?: unknown }
export const required = ["linuxUser", "socket", "endpoint", "rootless", "daemonOwner", "userService", "controllers", "image", "capacity", "exclusiveDaemon", "boundedLogs"] as const;
export type Check = typeof required[number];
export interface Snapshot {
  platform: string; uid?: number; kernel?: string; arch?: string;
  socket?: { owner: number; runtimeOwner: number; mode: number; runtimeMode: number; canonical: boolean; isSocket: boolean };
  endpoint?: { matches: boolean; isolatedConfig: boolean; rootfulAccessible: boolean; normalized?: string };
  recommendedEndpoint?: string;
  connection?: { endpoint: string; purpose: string; socketIdentity: string; daemonIdentity: string };
  daemon?: { rootless: boolean; cgroupVersion: string; driver: string; version: string; kernel: string; logging: string; components?: { name: string; version: string }[] };
  owner?: { uid: number; namespaceSeparated: boolean; serviceMember: boolean };
  service?: { active: string; delegate: string; controllers: string[] };
  image?: { id: string; revision: string; source: string; volumes: boolean };
  capacity?: { memoryAvailable: number; diskAvailable: number; localDisk: boolean };
  containers?: number; logs?: { bounded: boolean; driver: string };
}
export function evaluate(s: Snapshot, image: string, revision: string) {
  const checks: Record<string, Observation> = {};
  const add = (id: Check, known: boolean, passed: boolean, detail: string, evidence?: unknown, basis: Observation["basis"] = "observed") => {
    checks[id] = { status: !known ? "UNKNOWN" : passed ? "VERIFIED" : "FAILED", basis: known ? basis : "unknown", detail, ...(evidence === undefined ? {} : { evidence }) };
  };
  add("linuxUser", true, s.platform === "linux" && Number.isInteger(s.uid) && s.uid! > 0, "Run directly on Linux as the dedicated nonroot runner account", { platform: s.platform, uid: s.uid, kernel: s.kernel, arch: s.arch });
  const socket = s.socket;
  add("socket", !!socket, !!socket && socket.isSocket && socket.canonical && socket.owner === s.uid && socket.runtimeOwner === s.uid && (socket.runtimeMode & 0o777) === 0o700 && (socket.mode & 0o607) === 0o600, "Canonical user-owned socket inside private /run/user/UID", socket);
  add("endpoint", !!s.endpoint, !!s.endpoint && s.endpoint.matches && s.endpoint.isolatedConfig && !s.endpoint.rootfulAccessible, "Explicit rootless endpoint and isolated client config; rootful socket is inaccessible", s.endpoint);
  add("rootless", !!s.daemon, !!s.daemon?.rootless && s.daemon.driver === "systemd" && s.daemon.cgroupVersion === "2" && s.daemon.kernel === s.kernel, "Rootless daemon, host kernel and systemd cgroup v2 agree", s.daemon);
  add("daemonOwner", !!s.owner, !!s.owner && s.owner.uid === s.uid && s.owner.namespaceSeparated && s.owner.serviceMember, "One owned dockerd in a separate user namespace under the user service", s.owner);
  add("userService", !!s.service, s.service?.active === "active" && ["yes", "true"].includes(s.service.delegate), "Active delegated systemd user Docker service", s.service && { active: s.service.active, delegate: s.service.delegate });
  add("controllers", !!s.service, ["cpu", "memory", "pids"].every((c) => s.service?.controllers.includes(c)), "Required controllers actually exposed to user service; not proof of enforcement", s.service?.controllers);
  add("image", !!s.image, s.image?.id === image && s.image.revision === revision && s.image.source === "https://github.com/binaryrishabh/InfraForge" && !s.image.volumes, "Exact locally installed approved image/revision; no implicit volumes", s.image);
  // Conservative probe headroom, not a cloud capacity or scheduling guarantee.
  add("capacity", !!s.capacity, !!s.capacity && s.capacity.localDisk && s.capacity.memoryAvailable >= 2147483648 && s.capacity.diskAvailable >= 2147483648, "At least 2 GiB available memory/disk before serial bounded probes; no NFS data root", s.capacity);
  add("exclusiveDaemon", s.containers !== undefined, s.containers === 0, "Dedicated daemon has no containers before probing; no prune or automatic reaping", { containers: s.containers });
  add("boundedLogs", !!s.logs, s.logs?.bounded === true, "Default local logging driver has a documented rotation bound; verify effective container policy in operator review", s.logs, "configured");
  for (const id of ["resourceEnforcement", "lifecycle", "capacityOverTime", "controlAuthority", "disableRecovery", "runtimeConnectionStability"]) checks[id] = { status: "UNKNOWN", basis: "unknown", detail: "Requires actual-host enforcement or operational review; preflight cannot establish this" };
  checks.runtimeConnectionStability!.detail = "Repository mechanism selects one explicit endpoint with isolated client config and identity checks; actual deployment/account/daemon verification is still required";
  return { schema: "infraforge-lesson-host/1", kind: "read-only-preflight", checkedAt: new Date().toISOString(), rootlessReady: false,
    recommendedEndpoint: s.recommendedEndpoint, connection: s.connection,
    eligibleForProbes: required.every((id) => checks[id]!.status === "VERIFIED"), checks };
}
