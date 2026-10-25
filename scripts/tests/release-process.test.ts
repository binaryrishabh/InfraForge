import { expect, spyOn, test } from "bun:test";
import { collectCommand, command } from "../release/process";

const closed = () => new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
test("command deadline survives closed pipes while child stays alive", async () => {
  let killed = false;
  const child = { stdout: closed(), stderr: closed(), exited: new Promise<number>(() => {}), kill: () => { killed = true; } };
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(Promise.race([collectCommand(child, 20), new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error("test watchdog: child hung")), 200);
    })])).rejects.toThrow("deadline");
  } finally { clearTimeout(watchdog); }
  expect(killed).toBe(true);
});
test("command deadline also bounds inherited pipes after the child exits", async () => {
  const child = { stdout: new ReadableStream<Uint8Array>(), stderr: closed(), exited: Promise.resolve(0), kill: () => {} };
  await expect(collectCommand(child, 20)).rejects.toThrow("deadline");
});
test("command output cap kills and refuses without leaking captured output", async () => {
  let killed = false;
  const child = { stdout: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode("PRIVATE_CONFIG_MARKER")); } }),
    stderr: closed(), exited: new Promise<number>(() => {}), kill: () => { killed = true; } };
  await expect(collectCommand(child, 500, 4)).rejects.toThrow("output limit");
  expect(killed).toBe(true);
});
test("command collects output and exit together", async () => {
  expect(await collectCommand({ stdout: closed(), stderr: closed(), exited: Promise.resolve(7), kill: () => {} }, 500)).toEqual(["", "", 7]);
});

test("release Docker subprocess receives a pinned local endpoint", async () => {
  const spawn = spyOn(Bun, "spawn").mockReturnValue({ stdout: closed(), stderr: closed(), exited: Promise.resolve(0), kill: () => {} } as ReturnType<typeof Bun.spawn>);
  try {
    await command(["docker", "info"], ".", { DOCKER_CONTEXT: "default" });
    expect(spawn.mock.calls[0]?.[1]?.env).toMatchObject({ DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: undefined });
  } finally { spawn.mockRestore(); }
});
