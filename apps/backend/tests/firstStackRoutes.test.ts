import { expect, test } from "bun:test";
import express from "express";
import { createServer } from "node:http";
import { createFirstStackRouter } from "../firstStack/routes";
import type { FirstStackRepository, FirstStackDesign } from "../firstStack/service";
import { firstStackFixture } from "./firstStackFixture";

test("internal HTTP plumbing enforces operator/owner/revision and resolves without writing runs", async () => {
  const fixture = firstStackFixture();
  const row: FirstStackDesign = { id: "00000000-0000-4000-8000-000000000001", name: "test", ownerId: "owner", updatedAt: new Date("2026-10-20T00:00:00Z"), challengeId: null, layout: fixture.layout };
  let writes = 0;
  const repo: FirstStackRepository = { transaction: async task => task({ owned: async (id, owner) => row.id === id && owner === row.ownerId ? structuredClone(row) : null,
    update: async (_id, _owner, layout) => { writes++; row.layout = layout; return structuredClone(row); }, create: async next => { writes++; return { ...row, ...next }; } }) };
  const app = express();
  app.use((req, res, next) => { res.locals.userId = req.header("x-test-owner") ?? "owner"; res.locals.model2Scope = req.header("x-test-scope") ?? "operator"; next(); });
  app.use("/api/internal/model2/first-stack", createFirstStackRouter(repo));
  app.use((error: Error & { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.statusCode ?? 500).json({ message: error.message }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing test listener");
  const url = `http://127.0.0.1:${address.port}/api/internal/model2/first-stack`;
  const body = { infrastructureId: row.id, expectedDesignUpdatedAt: row.updatedAt.toISOString(), sidecar: fixture.sidecar };
  const post = (action: string, data: unknown, headers: Record<string, string> = {}) => fetch(`${url}/${action}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
  try {
    expect((await post("review", body, { "x-test-scope": "lesson" })).status).toBe(404);
    expect((await post("review", body, { "x-test-owner": "other" })).status).toBe(404);
    expect((await post("review", { ...body, expectedDesignUpdatedAt: "2020-01-01T00:00:00.000Z" })).status).toBe(409);
    expect((await post("review", body)).status).toBe(200); expect(writes).toBe(0);
    expect((await post("save", body)).status).toBe(200); expect(writes).toBe(1);
    const context = { infrastructureId: row.id, expectedDesignUpdatedAt: row.updatedAt.toISOString(), parameters: { schema: "infraforge-first-stack-parameters/1", rows: [{ id: "a", plan: "read-plan", keys: ["hot"] }] } };
    const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: 1000, origin: "authored-schedule", provenance: "test-only" };
    const data = [context, header, { id: "a", atUs: 10, operation: "read" }].map(v => JSON.stringify(v)).join("\n");
    const result = await fetch(`${url}/workload/resolve`, { method: "POST", headers: { "content-type": "application/x-infraforge-first-stack-import" }, body: data });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ executable: false, workload: { rows: [{ keys: ["hot"] }] } });
    expect(writes).toBe(1);
    const invalid = await fetch(`${url}/workload/resolve`, { method: "POST", headers: { "content-type": "application/x-infraforge-first-stack-import" }, body: data + "\n{broken}" });
    expect(invalid.status).toBe(422); expect(writes).toBe(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
