import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { text as streamText } from "node:stream/consumers";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DockerConnection } from "../../apps/backend/internalModel2/dockerConnection";
import { socketIdentity } from "../../apps/backend/internalModel2/dockerSocket";
import { containerName, createArguments, inspectContainer, removeContainer } from "../../apps/backend/internalModel2/sandboxDocker";
import { command } from "./command";
import { provenance } from "./identity";
async function removeOwned(path: string) {
  if (!resolve(path).startsWith(resolve(tmpdir(), "infraforge-endpoint-"))) throw Error("Unexpected endpoint fixture path");
  await rm(path, { recursive: true, force: true });
}
test.skipIf(process.platform !== "linux" || process.getuid?.() === 0)("Unix socket replacement and permission changes change identity", async () => {
  const path = await mkdtemp(join(tmpdir(), "infraforge-endpoint-")), socket = join(path, "docker.sock");
  let server = createServer((connection) => connection.end());
  const listen = () => new Promise<void>((done, reject) => { server.once("error", reject); server.listen(socket, done); });
  const close = () => new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()));
  try {
    await listen(); await chmod(socket, 0o600);
    const selected = { endpoint: `unix://${socket}`, socket, uid: process.getuid!(), purpose: "rootless" as const }, first = await socketIdentity(selected);
    await chmod(socket, 0o666); await expect(socketIdentity(selected)).rejects.toThrow(); await chmod(socket, 0o600);
    expect(await socketIdentity(selected)).not.toBe(first);
    await close(); server = createServer((connection) => connection.end()); await listen(); await chmod(socket, 0o600);
    expect(await socketIdentity(selected)).not.toBe(first);
  } finally { if (server.listening) await close(); await removeOwned(path); }
});
test.skipIf(process.env.LESSON_HOST_CI_REFUSAL !== "1")("real CLI context/environment drift cannot redirect create, attach or cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "infraforge-endpoint-")), log = join(directory, "calls.jsonl"), fail = join(directory, "fail"), changed = join(directory, "changed");
  const actualDocker = Bun.which("docker")!, node = Bun.which("node")!, wrapper = join(directory, "docker"), config = join(directory, "ambient");
  if (!actualDocker || !node) throw Error("Pinned CI requires Docker and Node");
  const saved = { ...process.env }, name = containerName(randomUUID()), image = process.env.MODEL2_LESSON_IMAGE!;
  let control: DockerConnection | undefined, created = false, cleaned = false;
  try {
    await writeFile(wrapper, `#!${node}\nconst fs=require('node:fs'),cp=require('node:child_process'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,env:Object.keys(process.env)})+'\\n');if(fs.existsSync(${JSON.stringify(fail)}))process.exit(75);if(fs.existsSync(${JSON.stringify(changed)})&&args.includes('{{.ID}}')){console.log('changed-daemon');process.exit(0)}const r=cp.spawnSync(${JSON.stringify(actualDocker)},args,{stdio:'inherit',env:{PATH:${JSON.stringify(saved.PATH)}}});process.exit(r.status??1);`, { mode: 0o700 });
    process.env.PATH = `${directory}:${saved.PATH}`;
    control = await DockerConnection.open(); const selected = control.receipt;
    await command(actualDocker, ["--config", config, "context", "create", "unreachable", "--docker", `host=unix://${directory}/absent.sock`]);
    await command(actualDocker, ["--config", config, "context", "use", "unreachable"]);
    for (const [key, value] of Object.entries({ HOME: directory, DOCKER_CONFIG: config, DOCKER_CONTEXT: "unreachable", DOCKER_HOST: `unix://${directory}/absent.sock`, DOCKER_TLS: "1", DOCKER_TLS_VERIFY: "1", DOCKER_CERT_PATH: directory, DOCKER_API_VERSION: "0.1", BUILDX_BUILDER: "unreachable", HTTP_PROXY: "http://127.0.0.1:9" })) process.env[key] = value;
    expect(JSON.parse(await command(actualDocker, ["--config", config, "context", "inspect"]))[0].Name).toBe("unreachable");
    expect(JSON.parse(await control.run(["image", "inspect", image]))[0].Id).toBe(image);
    const id = await control.run(createArguments(name, image));
    created = true;
    expect((await inspectContainer(control, id)).Image).toBe(image);
    const child = await control.attach(id), exit = new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("close", done); });
    const output = Promise.all([streamText(child.stdout), streamText(child.stderr)]);
    child.stdin.on("error", () => {}); child.stdin.end('{"mode":"unsupported"}\n');
    expect(await exit).not.toBe(0); await output;
    expect(control.receipt).toEqual(selected); await removeContainer(control, name, image); cleaned = true;
    expect(await control.run(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])).toBe("");
    const beforeMissing = (await readFile(log, "utf8")).trim().split("\n").length;
    process.env.MODEL2_LESSON_ENDPOINT = `unix:///run/user/${process.getuid!()}/docker.sock`; process.env.MODEL2_LESSON_DOCKER_MODE = "rootless";
    await expect(DockerConnection.open()).rejects.toThrow();
    expect((await readFile(log, "utf8")).trim().split("\n").length).toBe(beforeMissing);
    process.env.MODEL2_LESSON_ENDPOINT = saved.MODEL2_LESSON_ENDPOINT; process.env.MODEL2_LESSON_DOCKER_MODE = saved.MODEL2_LESSON_DOCKER_MODE;
    const before = (await readFile(log, "utf8")).trim().split("\n").length;
    await writeFile(fail, "fail"); await expect(control.run(["ps"])).rejects.toThrow("no endpoint fallback"); await rm(fail);
    expect((await readFile(log, "utf8")).trim().split("\n").length - before).toBe(1);
    await writeFile(changed, "changed"); await expect(control.run(["ps"])).rejects.toThrow("daemon changed");
    await rm(changed); await expect(control.run(["ps"])).rejects.toThrow("changed");
    const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    for (const call of calls) {
      expect(call.args.slice(0, 2)).toEqual(["--host", selected.endpoint]); expect(call.args[2]).toBe("--config"); expect(call.args[3]).not.toBe(config);
      expect(call.env.some((key: string) => /^(DOCKER_|BUILDX_|HTTP_PROXY|HTTPS_PROXY|NODE_OPTIONS)/.test(key))).toBe(false);
    }
    expect([...new Set(calls.map((c) => c.args[4]))]).toEqual(expect.arrayContaining(["info", "image", "create", "inspect", "start", "rm", "ps"]));
    await mkdir("/tmp/infraforge-m2m", { recursive: true });
    await Bun.write("/tmp/infraforge-m2m/endpoint-selection-proof.json", JSON.stringify({ schema: "infraforge-lesson-endpoint/1", commit: process.env.GITHUB_SHA, provenance: provenance(), environment: "disposable-rootful-CI", actualHost: "UNVERIFIED", connection: selected, contextChanged: true, environmentIgnored: true, noFallback: true, missingSocketRefused: true, daemonChangeRefused: true, calls }));
  } finally {
    try { if (control && created && !cleaned) await removeContainer(control, name, image); }
    finally {
      if (control) await control.close();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved);
      await removeOwned(directory);
    }
  }
}, 60000);
