import { expect, test } from "bun:test";
import http from "node:http";
import { EventEmitter } from "node:events";
import type { WebSocketServer } from "ws";
import { configureHttpServer, createShutdown } from "../utils/lifecycle";
import { startSocketHeartbeat } from "../utils/socketLifecycle";

test("shutdown drains an active HTTP request before closing resources and only runs once", async () => {
  let received!: () => void;
  const arrival = new Promise<void>(resolve => { received = resolve; });
  let finish!: () => void;
  const server = http.createServer((_req, res) => { finish = () => res.end("finished"); received(); });
  configureHttpServer(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const responses = fetch(`http://127.0.0.1:${address.port}`).then(res => res.text());
  await arrival;
  let closed = 0;
  const exits: number[] = [];
  const lifecycle = createShutdown(server, async () => { closed++; }, { exit: code => { exits.push(code); } });
  const stopping = lifecycle.shutdown();
  expect(lifecycle.shutdown()).toBe(stopping);
  expect(lifecycle.isStopping()).toBe(true);
  expect(closed).toBe(0);
  finish();
  expect(await responses).toBe("finished");
  await stopping;
  expect(closed).toBe(1);
  expect(exits).toEqual([0]);
});

test("shutdown fails within its deadline when resource cleanup never settles", async () => {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const exit = new Promise<number>(resolve => {
    const lifecycle = createShutdown(server, () => new Promise(() => {}), { deadlineMs: 30, exit: resolve });
    void lifecycle.shutdown();
  });
  expect(await exit).toBe(1);
});

test("heartbeat retires dead WebSocket clients and preserves responsive clients", async () => {
  const clients = new Set();
  const server = Object.assign(new EventEmitter(), { clients });
  const stop = startSocketHeartbeat(server as unknown as WebSocketServer, 10);
  const live = Object.assign(new EventEmitter(), { ping: () => live.emit("pong"), terminate: () => { clients.delete(live); } });
  const dead = Object.assign(new EventEmitter(), { ping: () => {}, terminate: () => { clients.delete(dead); } });
  clients.add(live); clients.add(dead);
  server.emit("connection", live); server.emit("connection", dead);
  try {
    await Bun.sleep(45);
    expect(clients.has(live)).toBe(true);
    expect(clients.has(dead)).toBe(false);
  } finally { stop(); }
});
