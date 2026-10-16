import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import type { DockerEndpoint } from "./dockerEndpoint";
export async function socketIdentity(connection: DockerEndpoint) {
  const value = await lstat(connection.socket, { bigint: true }), parentPath = await realpath(dirname(connection.socket)), parent = await lstat(parentPath, { bigint: true });
  const expected = connection.purpose === "rootless" ? connection.uid : 0;
  const canonical = connection.purpose === "rootless" ? connection.socket : "/run/docker.sock";
  if (!value.isSocket() || Number(value.uid) !== expected || Number(parent.uid) !== expected || await realpath(connection.socket) !== canonical ||
      connection.purpose === "rootless" && (parentPath !== dirname(connection.socket) || (Number(parent.mode) & 0o777) !== 0o700 || (Number(value.mode) & 0o607) !== 0o600) ||
      connection.purpose === "disposable-rootful-ci" && (Number(parent.mode) & 0o022) !== 0) throw Error("Lesson Docker socket identity/ownership refused");
  return createHash("sha256").update([value.dev, value.ino, value.ctimeNs, value.uid, value.gid, value.mode, parent.dev, parent.ino, parent.uid, parent.mode].join(":")).digest("hex");
}
