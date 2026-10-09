import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { attachDeploymentSubscription } from "../infra/deploymentSubscriptions";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const send = (socket: EventEmitter, id: string) => socket.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", deploymentId: id })));
const settle = () => Bun.sleep(0);

function fixture() {
  const messages: string[] = [];
  const socket = Object.assign(new EventEmitter(), { readyState: WebSocket.OPEN, send: (message: string) => messages.push(message),
    close: (code?: number) => socket.emit("close", code) });
  return { socket, messages, transport: socket as unknown as WebSocket };
}

test("deduplicates repeated subscriptions while the connection is pending", async () => {
  const { socket, transport } = fixture();
  let subscriptions = 0;
  let quits = 0;
  let resolve!: (connection: { quit: () => Promise<void> }) => void;
  attachDeploymentSubscription(transport, async () => {
    subscriptions++;
    return new Promise((ready) => { resolve = ready; });
  });
  send(socket, firstId);
  send(socket, firstId);
  expect(subscriptions).toBe(1);
  resolve({ quit: async () => { quits++; } });
  await settle();
  send(socket, firstId);
  expect(subscriptions).toBe(1);
  socket.emit("close");
  await settle();
  expect(quits).toBe(1);
});

test("closes a subscription that resolves after the socket disconnects", async () => {
  const { socket, transport } = fixture();
  let signal!: AbortSignal;
  let quits = 0;
  let resolve!: (connection: { quit: () => Promise<void> }) => void;
  attachDeploymentSubscription(transport, async (_id, _receive, lifetime) => {
    signal = lifetime;
    return new Promise((ready) => { resolve = ready; });
  });
  send(socket, firstId);
  socket.emit("close");
  expect(signal.aborted).toBe(true);
  resolve({ quit: async () => { quits++; } });
  await settle();
  expect(quits).toBe(1);
});

test("switches the single deployment subscription and suppresses stale events", async () => {
  const { socket, messages, transport } = fixture();
  const receivers = new Map<string, (event: unknown) => void>();
  const closed: string[] = [];
  attachDeploymentSubscription(transport, async (id, receive) => {
    receivers.set(id, receive);
    return { quit: async () => { closed.push(id); } };
  });
  send(socket, firstId);
  await settle();
  receivers.get(firstId)!({ deploymentId: firstId });
  send(socket, secondId);
  await settle();
  receivers.get(firstId)!({ stale: true });
  receivers.get(secondId)!({ deploymentId: secondId });
  expect(messages.map((message) => JSON.parse(message))).toEqual([{ deploymentId: firstId }, { deploymentId: secondId }]);
  expect(closed).toEqual([firstId]);
  socket.emit("close");
  await settle();
  expect(closed).toEqual([firstId, secondId]);
});

test("ignores malformed messages without allocating Redis subscribers", async () => {
  const { socket, transport } = fixture();
  let subscriptions = 0;
  attachDeploymentSubscription(transport, async () => { subscriptions++; return { quit: async () => {} }; });
  for (const message of ["invalid-json", "null", '{}', '{"type":"subscribe","deploymentId":"*"}']) {
    socket.emit("message", Buffer.from(message));
  }
  await settle();
  expect(subscriptions).toBe(0);
  socket.emit("close");
});

test("closes a failed subscription so clients can reconnect", async () => {
  const { socket, transport } = fixture();
  let closed = false;
  socket.once("close", () => { closed = true; });
  attachDeploymentSubscription(transport, async () => { throw new Error("Redis unavailable"); });
  send(socket, firstId);
  await settle();
  expect(closed).toBe(true);
});

test("rejects oversized UTF-8 messages before parsing or subscribing", async () => {
  const { socket, transport } = fixture();
  let subscriptions = 0;
  let closeCode: number | undefined;
  socket.once("close", (code) => { closeCode = code; });
  attachDeploymentSubscription(transport, async () => { subscriptions++; return { quit: async () => {} }; });
  send(socket, firstId + "é".repeat(600));
  await settle();
  expect(closeCode).toBe(1009);
  expect(subscriptions).toBe(0);
});
