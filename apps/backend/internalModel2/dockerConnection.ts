import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dockerInvocation, lessonEndpoint } from "./dockerEndpoint";
import type { DockerEndpoint } from "./dockerEndpoint";
import { socketIdentity } from "./dockerSocket";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
// Sending a signal does not settle a pending pipe read or a missing close event.
export async function boundProcess<T>(child: ChildProcess, work: () => Promise<T>, timeout: number, message: string, signal?: AbortSignal) {
  let reject!: (error: Error) => void, stopped = false;
  const interrupted = new Promise<never>((_resolve, no) => { reject = no; });
  const stop = (error: Error) => {
    if (stopped) return; stopped = true; reject(error);
    child.kill("SIGKILL"); child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
  };
  child.once("error", stop);
  const abort = () => stop(signal?.reason instanceof Error ? signal.reason : Error("Docker operation aborted"));
  const timer = setTimeout(() => stop(Error(message)), timeout);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    return await Promise.race([interrupted, ...(stopped ? [] : [work()])]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
    child.kill("SIGKILL"); child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
  }
}
export class DockerConnection {
  readonly #config: string;
  readonly #env: NodeJS.ProcessEnv;
  #stamp = ""; #daemon = ""; #closed = false; #changed = false;
  private constructor(readonly selected: DockerEndpoint, config: string) {
    this.#config = config;
    this.#env = Object.freeze({ PATH: process.env.PATH ?? process.env.Path ?? "" });
  }
  static async use<T>(run: (control: DockerConnection) => Promise<T>) {
    const control = await DockerConnection.open();
    try { return await run(control); } finally { await control.close(); }
  }
  static async open() {
    const selected = lessonEndpoint(); if (!selected) throw Error("MODEL2_LESSON_ENDPOINT is required; no default Docker context");
    const stamp = await socketIdentity(selected), config = await mkdtemp(join(tmpdir(), "infraforge-lesson-docker-"));
    const control = new DockerConnection(selected, config); control.#stamp = stamp;
    try {
      await writeFile(join(config, "config.json"), "{}\n", { mode: 0o600 });
      const info = JSON.parse(await control.#run(["info", "--format", "{{json .}}"]));
      if (typeof info.ID !== "string" || !info.ID.length || info.ID.length > 256 ||
          selected.purpose === "rootless" && (!info.SecurityOptions?.includes("name=rootless") || info.CgroupVersion !== "2" || info.CgroupDriver !== "systemd") ||
          selected.purpose === "disposable-rootful-ci" && info.SecurityOptions?.includes("name=rootless")) throw Error("Lesson daemon purpose/cgroup identity is incompatible");
      control.#daemon = digest(info.ID); await control.assertSocket(); return control;
    } catch (error) { await control.close(); throw error; }
  }
  get receipt() { return { endpoint: this.selected.endpoint, purpose: this.selected.purpose, socketIdentity: this.#stamp, daemonIdentity: this.#daemon }; }
  async assertSocket() {
    if (this.#closed || this.#changed) throw Error("Lesson Docker connection is closed or changed; no fallback");
    try { if (await socketIdentity(this.selected) !== this.#stamp) throw Error("Socket changed"); }
    catch { this.#changed = true; throw Error("Lesson Docker socket changed; no alternate daemon or cleanup fallback"); }
  }
  async assertIdentity() {
    await this.assertSocket();
    if (digest(await this.#run(["info", "--format", "{{.ID}}"] )) !== this.#daemon) { this.#changed = true; throw Error("Lesson Docker daemon changed; no fallback"); }
    await this.assertSocket();
  }
  async run(args: string[], cap = 65536, timeout = 5000) {
    await this.assertIdentity(); const result = await this.#run(args, cap, timeout); await this.assertIdentity(); return result;
  }
  async attach(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid attached container identity");
    await this.assertIdentity();
    return spawn("docker", dockerInvocation(this.selected, this.#config, ["start", "--attach", "--interactive", id]), { env: this.#env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  }
  async #run(args: string[], cap = 65536, timeout = 5000) {
    const child = spawn("docker", dockerInvocation(this.selected, this.#config, args), { env: this.#env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let text = "", size = 0;
    const controller = new AbortController();
    return boundProcess(child, async () => {
      const exited = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size > cap) controller.abort(Error("Docker control output exceeded its budget")); else if (stream === child.stdout) text += chunk.toString(); });
      const code = await exited;
      if (code !== 0) throw Error(`Docker operation failed (${code}); no endpoint fallback`);
      return text.trim();
    }, timeout, "Docker control operation timed out", controller.signal);
  }
  async close() {
    this.#closed = true;
    if (!resolve(this.#config).startsWith(resolve(tmpdir(), "infraforge-lesson-docker-"))) throw Error("Unexpected Docker client directory");
    await rm(this.#config, { recursive: true, force: true });
  }
}
