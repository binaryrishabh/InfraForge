import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { assertQualified, type HostQualification } from "./isolationPolicy";
import type { IsolationConfiguration } from "./isolationRunner";
import type { IsolationControl } from "./isolationConnection";

// Every ancestor and the file must be root-owned and not group/world writable.
// A root-installed atomic replacement is the only supported renewal operation.
export async function readProtectedJson(path: string): Promise<unknown> {
  if (process.platform !== "linux" || !isAbsolute(path)) throw Error("Protected Linux configuration required");
  for (let parent = dirname(path);; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022)) throw Error("Unsafe configuration directory");
    if (dirname(parent) === parent) break;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > 16384) {
      throw Error("Unsafe or oversized verifier configuration");
    }
    const bytes = Buffer.alloc(16385), read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 16384) throw Error("Verifier configuration too large");
    return JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"));
  } finally { await file.close(); }
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
