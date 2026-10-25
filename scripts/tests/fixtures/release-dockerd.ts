import type { StorageHost } from "../../release/storage";

export const dockerSockets = `u_str LISTEN 0 4096 /run/docker.sock 200 * 0 users:(("dockerd",pid=900,fd=3))
u_str ESTAB 0 0 * 401 * 402 users:(("dockerd",pid=900,fd=8))
u_str ESTAB 0 0 /run/containerd/containerd.sock 402 * 401 users:(("containerd",pid=812,fd=10))`;
export const dockerHost: StorageHost = {
  async read(path) {
    if (path === "/proc/900/stat") return `900 (dockerd) S ${Array(18).fill("0").join(" ")} 12000 0`;
    throw new Error(`Unexpected synthetic read: ${path}`);
  },
  async link(path) {
    if (path.endsWith("/ns/mnt")) return "mnt:[123]";
    if (path === "/proc/900/exe") return "/usr/bin/dockerd";
    if (path === "/proc/1/exe") return "/usr/lib/systemd/systemd";
    if (path === "/proc/900/root") return "/";
    throw new Error(`Unexpected synthetic link: ${path}`);
  },
  async metadata(path) {
    return { kind: path.endsWith("docker.sock") ? "socket" : "directory", uid: 0, mode: 0o755,
      ctimeMs: 900000, identity: path.endsWith("docker.sock") ? "docker-socket-inode" : path };
  },
};
