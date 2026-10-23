import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { assertQualified, type HostQualification } from "./isolationPolicy";
import type { IsolationConfiguration } from "./isolationRunner";
import type { IsolationControl } from "./isolationConnection";
import { hash } from "./canonical";
import { qualificationLease, readQualificationBaseline, selfCheckIntervalMs, selfCheckLeaseMs, type QualificationBaseline } from "./qualificationBaseline";

// Every ancestor and the file must be root-owned and not group/world writable.
// Full rehearsal records are installed atomically; live renewal stays in memory.
export async function readProtectedJson(path: string, maxBytes = 16384): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) throw Error("Invalid protected file budget");
  if (process.platform !== "linux" || !isAbsolute(path)) throw Error("Protected Linux configuration required");
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw Error("Unsafe configuration directory");
    if (dirname(parent) === parent) break;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > maxBytes) {
      throw Error("Unsafe or oversized verifier configuration");
    }
    const bytes = Buffer.alloc(maxBytes + 1), read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > maxBytes) throw Error("Verifier configuration too large");
    return JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"));
  } finally { await file.close(); }
}

export function createLiveQualification(configuration: IsolationConfiguration, control: IsolationControl,
  dependencies: { load(): Promise<unknown>; fingerprint(): Promise<string>; headroom(): void | Promise<void>;
    canary(baseline: QualificationBaseline): Promise<void>; now?: () => number }) {
  const now = dependencies.now ?? Date.now;
  let checkedAt: number | undefined, accepted = "", failed = false, renewing = false;
  const revoke = () => { failed = true; configuration.qualification = null; };
  async function baseline() {
    if (failed) throw Error("Live qualification failed; operator restart required");
    await dependencies.headroom();
    const value = readQualificationBaseline(await dependencies.load(),
      { ...configuration, daemon: control.identity }, await dependencies.fingerprint(), now());
    if (accepted && accepted !== hash(value)) throw Error("Installed qualification changed; restart required");
    return value;
  }
  async function refresh() {
    try {
      const value = await baseline();
      if (checkedAt === undefined || checkedAt > now() || now() >= checkedAt + selfCheckLeaseMs) {
        throw Error("Live qualification lease missing or expired");
      }
      await refreshVerifierQualification(configuration, control, async () => qualificationLease(value, checkedAt!));
      if (failed) throw Error("Concurrent qualification failure");
    } catch (error) { revoke(); throw error; }
  }
  return {
    refresh, revoke,
    due: () => checkedAt === undefined || now() - checkedAt >= selfCheckIntervalMs,
    async renew() {
      if (renewing) throw Error("Qualification renewal already running");
      renewing = true;
      try {
        const value = await baseline(), before = hash(value), began = now();
        await dependencies.canary(value);
        // Detect changes during the probe, including a concurrent failed refresh.
        if (hash(await baseline()) !== before || failed || now() < began) throw Error("Qualification changed during canary");
        accepted = before; checkedAt = began;
        await refresh();
      } catch (error) { revoke(); throw error; }
      finally { renewing = false; }
    },
  };
}

export async function refreshVerifierQualification(configuration: IsolationConfiguration, control: IsolationControl,
  load: () => Promise<unknown>) {
  try {
    const value = await load() as HostQualification;
    assertQualified(value, { ...configuration, daemon: control.identity });
    if (value.target !== "ec2-c7i-flex.large") throw Error("Production EC2 qualification required");
    await control.assertIdentity();
    const image = JSON.parse(await control.run(["image", "inspect", configuration.image]));
    if (image.length !== 1 || image[0]?.Id !== configuration.image || image[0]?.Os !== "linux") {
      throw Error("Qualified executor image unavailable");
    }
    configuration.qualification = value;
  } catch (error) { configuration.qualification = null; throw error; }
}
