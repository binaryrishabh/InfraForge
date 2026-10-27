import { expect, test } from "bun:test";
import { browserFixture } from "../fixtures/browser-runner";
import { executeBrowser } from "../../apps/web/src/firstStack/worker/execute";
import { createFirstStackSubmissionClient, SubmissionError } from "../../apps/web/src/firstStack/submissions";
import type { SubmissionOptions } from "../../apps/web/src/firstStack/submissions";
import { createSubmissionService } from "../../apps/backend/firstStack/admission";
import { publicChallenge } from "../../apps/backend/firstStack/scoredChallenges/definition";
import { canonical, hash } from "../../apps/backend/firstStack/canonical";
import type { Pool } from "pg";

const id = "00000000-0000-4000-8000-000000000026";
const available = (o: SubmissionOptions) => ({ available: true, engine: o.run.engine, expiresAt: Date.now() + 5000 });
async function options(scored = false): Promise<SubmissionOptions> {
  const run = await browserFixture();
  const sample = scored ? await publicChallenge(run.input.owner, "lose-an-app-server", "2") : null;
  if (sample) run.input = { owner: run.input.owner, layout: sample.layout, candidate: sample.layout.firstStack, recording: sample.workload, policy: sample.policy };
  return { run, result: await executeBrowser(run), idempotencyKey: "browser-26",
    ...(sample ? { purpose: "scored" as const, challenge: { id: sample.id, version: sample.version } } : { purpose: "shared" as const }),
    design: { infrastructureId: id, updatedAt: "2026-10-21T00:00:00.000Z", revision: run.input.candidate.designRevision } };
}
function admission(o: SubmissionOptions) {
  const calls: string[] = []; let previous: { id: string; requestHash: unknown } | null = null;
  const db = { release() {}, async query(sql: string, args: unknown[] = []) {
    calls.push(sql);
    if (sql.includes('AS live')) return { rows: [{ recorded: "500", live: "0", runs: "0", cuts: "0", results: "0", replays: "0", physical: "0" }] };
    if (sql.startsWith('SELECT id,"requestHash"')) return { rows: previous ? [previous] : [], rowCount: previous ? 1 : 0 };
    if (sql.startsWith("SELECT id,layout")) return { rows: [{ id, layout: o.run.input.layout, challengeId: null, updatedAt: new Date(o.design.updatedAt) }] };
    if (sql.startsWith("SELECT count(*)::int")) return { rows: [{ count: 0, queued: 0, owned: 0 }] };
    if (sql.startsWith("SELECT count(*) FILTER")) return { rows: [{ queued: 0, owned: 0, bytes: 0 }] };
    if (sql.startsWith('INSERT INTO "FirstStackRun"')) {
      expect(args[8]).toEqual(o.result.evidence!.cut.lock); expect(args[9]).toBe(o.run.input.policy.seed);
      if (o.purpose === "scored") expect(args[10]).toMatchObject({ origin: "server-challenge", challenge: o.challenge });
      previous = { id: args[0] as string, requestHash: args[3] };
    }
    return { rows: [], rowCount: 1 };
  } };
  return { calls, service: createSubmissionService({ connect: async () => db } as unknown as Pool,
    { enabled: true, available: async () => true, engine: o.run.engine }) };
}
async function projection(o: SubmissionOptions, result: unknown = null, status = "queued") {
  const row = { id, purpose: o.purpose, input: canonical(o.run.input), inputHash: o.result.evidence!.inputHash,
    engine: o.run.engine, lock: o.result.evidence!.cut.lock, browserCut: o.result.evidence,
    durablePrefix: result ? o.result.evidence : null, result, resultHash: result ? hash(result) : null,
    lineage: { infrastructureId: id }, status, createdAt: new Date(o.design.updatedAt) };
  const pool = { query: async (_sql: string, args: unknown[]) => ({ rows: args[0] === id && args[1] === o.run.input.owner ? [row] : [] }) };
  return createSubmissionService(pool as unknown as Pool).read(o.run.input.owner, id);
}

for (const scored of [false, true]) test(`client emits the actual strict admission schema (${scored ? "scored" : "shared"}) and retries the same key`, async () => {
  const o = await options(scored), { calls, service } = admission(o), bodies: string[] = [];
  let lostReceipt = true;
  const client = createFirstStackSubmissionClient({ endpoint: "/test-submissions", owner: () => o.run.input.owner,
    fetch: (async (url: string, init: RequestInit) => {
      expect(init.credentials).toBe("same-origin"); expect(init.redirect).toBe("error"); expect(init.cache).toBe("no-store");
      if (url.endsWith("/availability")) return Response.json(available(o));
      expect(url).toBe("/test-submissions/"); bodies.push(init.body as string);
      const receipt = await service.submit(o.run.input.owner, JSON.parse(init.body as string));
      if (lostReceipt) { lostReceipt = false; throw Error("Response lost after admission"); }
      return Response.json(receipt, { status: receipt.reused ? 200 : 201 });
    }) as typeof fetch });
  expect((await client.availability()).engine).toEqual(o.run.engine);
  await expect(client.submit(o)).rejects.toThrow("Response lost");
  expect((await client.submit(o)).reused).toBe(true);
  expect(bodies[0]).toBe(bodies[1]);
  expect(Object.keys(JSON.parse(bodies[0]!)).sort()).toEqual(["browserCut", ...(scored ? ["challenge"] : []), "engine", "expectedDesignRevision", "expectedDesignUpdatedAt", "idempotencyKey", "infrastructureId", "policy", "purpose", "workload"].sort());
  expect(calls.filter(sql => sql.startsWith('INSERT INTO "FirstStackOutbox"'))).toHaveLength(1);
});

test("client rejects owner changes, mutated evidence, unfinished runs and oversized evidence before transport", async () => {
  let requests = 0, owner = "qualification";
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => owner, fetch: (async () => { requests++; return Response.json({ id, reused: false }); }) as typeof fetch });
  const o = await options(); owner = "another-owner";
  await expect(client.submit(o)).rejects.toThrow("owner"); owner = "qualification";
  o.result.evidence!.fingerprint = "a".repeat(64); await expect(client.submit(o)).rejects.toThrow("changed");
  const editedCapture = await options(); editedCapture.result.evidence!.cut.reportCapture.selection.omitted++;
  await expect(client.submit(editedCapture)).rejects.toThrow("changed");
  const unfinished = await options(); unfinished.result.status = "interrupted"; await expect(client.submit(unfinished)).rejects.toThrow("finished");
  const oversized = await options(); oversized.result.evidence!.cut.distributions = "x".repeat(1024 * 1024);
  await expect(client.submit(oversized)).rejects.toThrow("byte budget");
  const missing = await options(true); delete (missing as { challenge?: unknown }).challenge;
  await expect(client.submit(missing)).rejects.toThrow("challenge");
  expect(requests).toBe(0);
});

test("client freezes reviewed input and preserves HTTP errors without automatic retries", async () => {
  const o = await options(), seed = o.run.input.policy.seed;
  let status = 409, requests = 0;
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => "qualification", fetch: (async (url: string, init: RequestInit) => {
    if (url.endsWith("/availability")) return Response.json(available(o));
    requests++; expect(JSON.parse(init.body as string).policy.seed).toBe(seed); return new Response(null, { status });
  }) as typeof fetch });
  const pending = client.submit(o); o.run.input.policy.seed = "edited-after-click";
  await expect(pending).rejects.toBeInstanceOf(SubmissionError);
  o.run.input.policy.seed = seed;
  for (status of [404, 429, 503]) await expect(client.submit(o)).rejects.toMatchObject({ status });
  expect(requests).toBe(4);
});

test("authenticated availability rejects a stale source pin, changed image, expired or unavailable engine", async () => {
  const o = await options(); let state: unknown = available(o), posts = 0;
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => "qualification", fetch: (async (_url: unknown, init: RequestInit) => {
    if (init.method === "POST") posts++;
    return Response.json(state);
  }) as typeof fetch });
  state = { ...available(o), engine: { ...o.run.engine, source: "f".repeat(64) } };
  await expect(client.submit(o)).rejects.toThrow("pin stale");
  state = { ...available(o), engine: { ...o.run.engine, image: `sha256:${"c".repeat(64)}` } };
  await expect(client.submit(o)).rejects.toThrow("engine changed");
  state = { ...available(o), expiresAt: Date.now() - 1 }; await expect(client.submit(o)).rejects.toThrow("unavailable");
  state = { available: false, engine: null }; expect(await client.availability()).toEqual(state);
  await expect(client.submit(o)).rejects.toMatchObject({ status: 503 }); expect(posts).toBe(0);
});

test("read accepts actual RunRecord and safe score projections without ownerId or raw result", async () => {
  const o = await options(true), calls: Array<[string, RequestInit]> = [], controller = new AbortController();
  const score = { schema: "infraforge-server-score/1", challenge: { id: "lose-an-app-server", version: "2" }, rubricVersion: "fixture",
    assessment: "incomplete", earned: 0, assessed: 0, pending: 1, systemPassed: false, support: "supported-logical",
    workloads: [{ input: "PRIVATE-SENTINEL", outcomes: [{ id: "cost", required: true, outcome: "Unknown", reason: "private reason", support: "Unknown" }] }] };
  let body = await projection(o);
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => "qualification", fetch: (async (url: string, init: RequestInit) => {
    calls.push([url, init]); return init.method === "POST" ? new Response(null, { status: 204 }) : Response.json(body);
  }) as typeof fetch });
  expect((await client.read(id, controller.signal)).status).toBe("queued"); await client.cancel(id, controller.signal);
  expect(calls.map(([url]) => url)).toEqual([`/test/${id}`, `/test/${id}/cancel`]);
  expect(calls.every(([, init]) => init.cache === "no-store" && init.signal === controller.signal)).toBe(true);
  body = await projection(o, { verification: "verified", actual: o.result.evidence!.fingerprint, score }, "terminal");
  const read = await client.read(id);
  expect(read).toEqual(body); expect(read.score).toMatchObject({ schema: "infraforge-score-summary/1", pending: 1, criteria: [{ outcome: "Unknown" }] });
  expect(read).not.toHaveProperty("ownerId"); expect(read).not.toHaveProperty("result"); expect(read).not.toHaveProperty("browserCut");
  expect(JSON.stringify(read)).not.toContain("PRIVATE-SENTINEL"); expect(JSON.stringify(read.score)).not.toContain("private reason");
  body = await projection(o, { verification: "verified", actual: o.result.evidence!.fingerprint,
    score: { schema: "infraforge-scoring-unavailable/1", state: "unavailable" } }, "terminal");
  expect((await client.read(id)).score).toEqual({ schema: "infraforge-scoring-unavailable/1", state: "unavailable", message: "Scoring unavailable" });
  body = { ...body, id: "foreign" }; await expect(client.read(id)).rejects.toThrow("RunRecord");
  await expect(client.cancel("../foreign")).rejects.toThrow("UUID");
  expect(() => createFirstStackSubmissionClient({ endpoint: "//foreign", owner: () => null })).toThrow("same-origin");
});

for (const nextOwner of [null, "another-owner"]) for (const phase of ["transport", "json"] as const) {
  test(`read rejects ${nextOwner === null ? "logout" : "owner switch"} during ${phase}`, async () => {
    const o = await options(), body = await projection(o); let owner: string | null = "qualification";
    const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => owner, fetch: (async () => {
      if (phase === "transport") owner = nextOwner;
      return { ok: true, json: async () => { if (phase === "json") owner = nextOwner; return body; } } as Response;
    }) as typeof fetch });
    await expect(client.read(id)).rejects.toThrow(/owner/i);
  });
}

test("submit and availability discard responses after an owner change", async () => {
  const o = await options(); let owner: string | null = "qualification", changeOnPost = false;
  const client = createFirstStackSubmissionClient({ endpoint: "/test", owner: () => owner, fetch: (async (_url: unknown, init: RequestInit) => {
    if (!changeOnPost || init.method === "POST") owner = null;
    return Response.json(init.method === "POST" ? { id, reused: false } : available(o));
  }) as typeof fetch });
  await expect(client.availability()).rejects.toThrow(/owner/i);
  owner = "qualification"; changeOnPost = true; await expect(client.submit(o)).rejects.toThrow(/owner/i);
});
