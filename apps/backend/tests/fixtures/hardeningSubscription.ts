// Isolated process: fixture DNS only, no caller-supplied production settings.
import { strict as assert } from "node:assert";
import net from "node:net";
process.env.REDIS_HOST = "hardening-redis";
process.env.REDIS_PORT = "6379";
const { commandRedis, redis } = await import("../../infra/redis");
const { subscribeToDeployment } = await import("../../infra/pubsub");
const captured: ReturnType<typeof commandRedis.duplicate>[] = [];
const duplicate = commandRedis.duplicate.bind(commandRedis);
let blackholePort: number | undefined;
commandRedis.duplicate = (options) => {
  const client = duplicate({ ...options, ...(blackholePort ? { host: "127.0.0.1", port: blackholePort } : {}) });
  assert.equal(client.status, "wait");
  captured.push(client);
  return client;
};
const sockets = new Set<net.Socket>();
let server: net.Server | undefined;
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() > end) throw Error("Fixture did not settle: " + captured.map(client => client.status).join(",")); await Bun.sleep(10); }
}
try {
  await until(() => commandRedis.status === "ready");
  const controller = new AbortController();
  let event: unknown;
  const id = `owned-${process.pid}`;
  const client = await subscribeToDeployment(id, value => { event = value; }, controller.signal);
  assert.equal(client.status, "ready");
  await commandRedis.publish(`deployment:${id}:updates`, JSON.stringify({ fixture: "ready" }));
  await until(() => event !== undefined);
  assert.deepEqual(event, { fixture: "ready" });
  controller.abort();
  await until(() => client.status === "end");
  assert.equal(await commandRedis.publish(`deployment:${id}:updates`, "{}"), 0);

  const closed = new AbortController(); closed.abort();
  await assert.rejects(subscribeToDeployment(id, () => {}, closed.signal), /Subscription closed/);
  await until(() => captured.at(-1)!.status === "end");

  server = net.createServer(socket => { sockets.add(socket); socket.on("error", () => {}); socket.resume(); });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  blackholePort = (server.address() as net.AddressInfo).port;
  const connecting = new AbortController();
  const pending = subscribeToDeployment(id, () => {}, connecting.signal);
  setTimeout(() => connecting.abort(), 25);
  await assert.rejects(pending, /Subscription closed/);
  await until(() => captured.at(-1)!.status === "end");

  const started = Date.now();
  await assert.rejects(subscribeToDeployment(id, () => {}), /deadline|timeout|closed/i);
  assert.ok(Date.now() - started < 6500);
  await until(() => captured.at(-1)!.status === "end");
  console.log("SUBSCRIPTION PROOF PASS: real subscribe/publish, lazy readiness, preabort, connecting abort, bounded failure and disconnect");
} finally {
  for (const client of captured) client.disconnect();
  commandRedis.disconnect(); redis.disconnect();
  for (const socket of sockets) socket.destroy();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
}
