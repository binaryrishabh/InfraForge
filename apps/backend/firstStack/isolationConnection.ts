import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundProcess } from "../internalModel2/dockerConnection";
import { FIRST_STACK_ISOLATION as limits, isolationDigest } from "./isolationPolicy";

// Explicit local endpoint only. No context, credential helper, inherited Docker
// configuration, TLS environment, or remote daemon fallback.
export class IsolationConnection {
  private constructor(readonly endpoint: string, private readonly config: string) {}
  private daemon = "";
  private socket = "";
  private closed = false;
  private readonly env = Object.freeze({ PATH: process.env.PATH ?? process.env.Path ?? "", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}) });
  static async open(endpoint: string) {
    const allowed = process.platform === "win32"
      ? endpoint === "npipe:////./pipe/dockerDesktopLinuxEngine"
      : process.platform === "linux" && /^unix:\/\/\/(?:var\/run\/docker\.sock|run\/user\/[1-9][0-9]*\/docker\.sock)$/.test(endpoint);
    if (!allowed) throw Error("Select an explicit local Linux Docker endpoint; no fallback");
    const connection = new IsolationConnection(endpoint, await mkdtemp(join(tmpdir(), "infraforge-first-stack-")));
    try {
      await writeFile(join(connection.config, "config.json"), "{}\n", { mode: 0o600 });
      connection.socket = await connection.socketStamp();
      const info = JSON.parse(await connection.command(["info", "--format", "{{json .}}"]));
      if (info.OSType !== "linux" || info.CgroupVersion !== "2" || typeof info.ID !== "string" || !info.ID) throw Error("Linux cgroup v2 daemon required");
      connection.daemon = isolationDigest(info.ID);
      return connection;
    } catch (error) { await connection.close(); throw error; }
  }
  get identity() { return this.daemon; }
  private async socketStamp() {
    if (process.platform === "win32") return this.endpoint;
    const path = this.endpoint.slice(7), value = await lstat(path, { bigint: true });
    if (!value.isSocket()) throw Error("Docker endpoint is not a socket");
    return isolationDigest([await realpath(path), value.dev, value.ino, value.ctimeNs, value.uid, value.gid, value.mode].join(":"));
  }
  async assertIdentity() {
    if (this.closed || await this.socketStamp() !== this.socket ||
      isolationDigest(await this.command(["info", "--format", "{{.ID}}"])) !== this.daemon) throw Error("Docker endpoint identity changed; execution disabled");
  }
  private arguments(args: string[]) {
    if (!args.length || args[0]!.startsWith("-") || args.some(v => /^(-H|--host(?:=|$)|--context(?:=|$)|--config(?:=|$)|--tls)/.test(v))) throw Error("Docker endpoint override refused");
    return ["--host", this.endpoint, "--config", this.config, ...args];
  }
  private async command(args: string[], cap = 1024 * 1024, timeout: number = limits.controlMs) {
    const child = spawn("docker", this.arguments(args), { env: this.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const abort = new AbortController();
    return boundProcess(child, async () => {
      let size = 0, output = "";
      const exited = new Promise<number | null>((yes, no) => { child.once("error", no); child.once("close", yes); });
      void exited.catch(() => {});
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > cap) abort.abort(Error("Docker control output budget exceeded"));
        else if (stream === child.stdout) output += chunk.toString("utf8");
      });
      if (await exited !== 0) throw Error("Docker control failed; no retry on another endpoint");
      return output.trim();
    }, timeout, "Docker control deadline exceeded", abort.signal);
  }
  async run(args: string[], cap?: number, timeout?: number) {
    await this.assertIdentity();
    const value = await this.command(args, cap, timeout);
    await this.assertIdentity();
    return value;
  }
  async attach(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid container identity");
    await this.assertIdentity();
    return spawn("docker", this.arguments(["start", "--attach", "--interactive", id]),
      { env: this.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  }
  async close() { this.closed = true; await rm(this.config, { recursive: true, force: true }); }
}
export type IsolationControl = Pick<IsolationConnection, "identity" | "run" | "assertIdentity" | "attach">;
