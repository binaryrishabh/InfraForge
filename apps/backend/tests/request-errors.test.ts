import { expect, test } from "bun:test";
import express from "express";
import { errorHandler } from "../utils/middleware";

test("returns client errors for malformed, oversized and unsupported JSON and remains available", async () => {
  const app = express();
  app.use(express.json());
  app.post("/body", (_request, response) => response.json({ success: true }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no local port");
    const request = (body: string) => fetch(`http://127.0.0.1:${address.port}/body`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    const malformed = await request("{");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ success: false, message: "Invalid JSON body" });
    const oversized = await request(JSON.stringify({ name: "x".repeat(110000) }));
    expect(oversized.status).toBe(413);
    const unsupported = await fetch(`http://127.0.0.1:${address.port}/body`, {
      method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "unsupported" }, body: "{}",
    });
    expect(unsupported.status).toBe(415);
    const valid = await request("{}");
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ success: true });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
