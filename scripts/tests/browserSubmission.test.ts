import { expect, test } from "bun:test";
import { browserFixture } from "../fixtures/browser-runner";
import { executeBrowser } from "../../apps/web/src/firstStack/worker/execute";
import { createFirstStackSubmissionClient, SubmissionError } from "../../apps/web/src/firstStack/submissions";
import type { SubmissionOptions } from "../../apps/web/src/firstStack/submissions";
import { createSubmissionService } from "../../apps/backend/firstStack/admission";
import type { Pool } from "pg";

const id = "00000000-0000-4000-8000-000000000026";
async function options(): Promise<SubmissionOptions> {
  const run = await browserFixture();
  return { run, result: await executeBrowser(run), idempotencyKey: "browser-26", purpose: "shared",
    design: { infrastructureId: id, updatedAt: "2026-10-21T00:00:00.000Z", revision: run.input.candidate.designRevision } };
}
test("typed client emits the slice 11 strict schema; actual admission recompiles and accepts its cut", async () => {
  const o = await options(), calls: string[] = [];
  const db = { release() {}, async query(sql: string, args: unknown[] = []) {
    calls.push(sql);
    if (sql.startsWith('SELECT id,"requestHash"')) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT id,layout")) return { rows: [{ id, layout: o.run.input.layout, challengeId: null, updatedAt: new Date(o.design.updatedAt) }] };
    if (sql.startsWith("SELECT count(*)::int")) return { rows: [{ count: 0 }] };
    if (sql.startsWith("SELECT count(*) FILTER")) return { rows: [{ queued: 0, owned: 0, bytes: 0, retained: 0 }] };
    if (sql.startsWith('INSERT INTO "FirstStackRun"')) { expect(args[8]).toEqual(o.result.evidence!.cut.lock); expect(args[9]).toBe(o.run.input.policy.seed); }
    return { rows: [], rowCount: 1 };
  } };
  const service = createSubmissionService({ connect: async () => db } as unknown as Pool, { enabled: true, engine: o.run.engine });
  let wire: Record<string, unknown> = {};
  const client = createFirstStackSubmissionClient({ endpoint: "/test-submissions", owner: () => o.run.input.owner,
    fetch: (async (url: string | URL | Request, init: RequestInit) => {
      expect(url).toBe("/test-submissions/"); expect(init.credentials).toBe("same-origin"); expect(init.redirect).toBe("error");
      wire = JSON.parse(init.body as string);
      return Response.json(await service.submit(o.run.input.owner, wire), { status: 201 });
    }) as unknown as typeof fetch });
  const receipt = await client.submit(o); expect(receipt.reused).toBe(false);
  expect(Object.keys(wire).sort()).toEqual(["browserCut", "engine", "expectedDesignRevision", "expectedDesignUpdatedAt", "idempotencyKey", "infrastructureId", "policy", "purpose", "workload"]);
  expect(calls.some(sql => sql.startsWith('INSERT INTO "FirstStackOutbox"'))).toBe(true);
});
test("client rejects owner changes, mutated evidence, unfinished runs and oversized evidence before transport", async () => {
  let requests = 0, owner = "qualification";
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => owner, fetch: (async () => { requests++; return Response.json({ id, reused: false }); }) as unknown as typeof fetch });
  const o = await options(); owner = "another-owner";
  await expect(client.submit(o)).rejects.toThrow("owner"); owner = "qualification";
  o.result.evidence!.fingerprint = "a".repeat(64); await expect(client.submit(o)).rejects.toThrow("changed");
  const unfinished = await options(); unfinished.result.status = "interrupted"; await expect(client.submit(unfinished)).rejects.toThrow("finished");
  const oversized = await options(); oversized.result.evidence!.cut.distributions = "x".repeat(1024 * 1024);
  await expect(client.submit(oversized)).rejects.toThrow("byte budget");
  expect(requests).toBe(0);
});
test("client freezes reviewed input and keeps HTTP conflict/rate/unavailable errors without retries", async () => {
  const o = await options(), seed = o.run.input.policy.seed;
  let status = 409, requests = 0;
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => "qualification", fetch: (async (_url: unknown, init: RequestInit) => {
    requests++; expect(JSON.parse(init.body as string).policy.seed).toBe(seed); return new Response(null, { status });
  }) as typeof fetch });
  const pending = client.submit(o); o.run.input.policy.seed = "edited-after-click";
  await expect(pending).rejects.toBeInstanceOf(SubmissionError);
  o.run.input.policy.seed = seed;
  for (status of [404, 429, 503]) await expect(client.submit(o)).rejects.toMatchObject({ status });
  expect(requests).toBe(4);
});
test("read/cancel use owned paths, no-store, abort signals and reject foreign projections", async () => {
  const calls: Array<[string, RequestInit]> = [], controller = new AbortController(); let foreign = false;
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => "qualification", fetch: (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return init.method === "POST" ? new Response(null, { status: 204 }) : Response.json({ id, ownerId: foreign ? "another" : "qualification", status: "queued" });
  }) as typeof fetch });
  expect((await client.read(id, controller.signal)).status).toBe("queued"); await client.cancel(id, controller.signal);
  expect(calls.map(([url]) => url)).toEqual([`/test/${id}`, `/test/${id}/cancel`]);
  expect(calls.every(([, init]) => init.cache === "no-store" && init.signal === controller.signal)).toBe(true);
  foreign = true; await expect(client.read(id)).rejects.toThrow("owned");
  await expect(client.cancel("../foreign")).rejects.toThrow("UUID");
  expect(() => createFirstStackSubmissionClient({ endpoint: "//foreign", owner: () => null })).toThrow("same-origin");
});
