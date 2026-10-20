import { expect, test } from "bun:test";
import net from "node:net";
import Redis from "ioredis";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseAdapterPolicy, databasePoolPolicy, outboxRetryDelay, redisPolicy } from "../utils/connectionPolicy";

async function blackhole() {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, drop: () => { for (const socket of sockets) socket.destroy(); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

test("PostgreSQL handshake stalls expire and the pool releases waiting requests", async () => {
  const endpoint = await blackhole();
  const pool = new Pool({ ...databasePoolPolicy, host: "127.0.0.1", port: endpoint.port,
    user: "fixture", database: "fixture", password: "fixture", max: 1, connectionTimeoutMillis: 100 });
  pool.on("error", () => {});
  try {
    const result = await Promise.allSettled([pool.query("SELECT 1"), pool.query("SELECT 1")]);
    expect(result.every(item => item.status === "rejected")).toBe(true);
    expect(pool.waitingCount).toBe(0);
  } finally { await pool.end(); await endpoint.close(); }
});

// Bun 1.3.14 on Windows crashes in native socket teardown for this fault.
// The mandatory Linux proof runs the real mid-request disconnect test.
test.skipIf(process.platform === "win32")("Redis command failure is bounded both for a blackhole and connection loss mid-request", async () => {
  const endpoint = await blackhole();
  const client = new Redis({ ...redisPolicy(), host: "127.0.0.1", port: endpoint.port,
    lazyConnect: true, protocol: 2, enableReadyCheck: false, disableClientInfo: true, commandTimeout: 100, retryStrategy: () => null });
  client.on("error", () => {});
  try {
    await client.connect();
    await expect(client.ping()).rejects.toThrow();
    const pending = client.ping();
    endpoint.drop();
    await expect(pending).rejects.toThrow();
    await expect(client.publish("fixture", "event")).rejects.toThrow();
  } finally {
    client.disconnect();
    await endpoint.close();
  }
});

test("disconnecting the Prisma adapter also closes the externally supplied pool", async () => {
  const pool = new Pool(databasePoolPolicy);
  const adapter = await new PrismaPg(pool, databaseAdapterPolicy).connect();
  await adapter.dispose();
  await expect(pool.connect()).rejects.toThrow("Cannot use a pool after calling end");
});

test("outbox failures use bounded exponential backoff with jitter", () => {
  expect([1, 2, 3, 4, 100].map(count => outboxRetryDelay(count, () => 0))).toEqual([4000, 8000, 16000, 24000, 24000]);
  expect(outboxRetryDelay(1, () => 0.99)).toBeGreaterThan(4000);
  expect(outboxRetryDelay(100, () => 0.99)).toBeLessThanOrEqual(30000);
});
