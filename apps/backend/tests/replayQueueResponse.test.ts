import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { DeploymentReadResponse, ReplayQueueStatus } from "@infraforge/contracts/deployment";
import { deploymentReadResponse, replayQueueQuery } from "../replay/deploymentResponse";
import { ReplayQueueStatusSchema } from "../replay/contract";
import type { ReplayQueueRow } from "../replay/queueStatus";

const limits = { active: 2, queued: 20 };
const run = (status = "pending", browserSubmission: unknown = { stopAtSecond: 10, actions: [] }): ReplayQueueRow => ({
  id: "target", status, browserSubmission, createdAt: new Date(0), updatedAt: new Date(0),
});

test("one injected bounded global read exposes only aggregate replay data", async () => {
  const calls: number[] = [];
  const deployment = run();
  const response = await deploymentReadResponse(deployment, async take => { calls.push(take); return [deployment, { ...run("running"), id: "private-run" }]; }, limits);
  expect(calls).toEqual([23]);
  expect(replayQueueQuery).toEqual({ where: { OR: [{ status: { in: ["pending", "running", "live"] } }, { runtimeActive: true }] },
    select: { id: true, status: true, createdAt: true, updatedAt: true, browserSubmission: true },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  expect(response).toEqual({ success: true, deployment, replay: { state: "queued", position: 1, runsAhead: 1, estimatedWaitSeconds: 2.25, basis: expect.any(String) } });
  expect(JSON.stringify(response)).not.toContain("private-run");
  expect(Object.keys(response.replay!).sort()).toEqual(["basis", "estimatedWaitSeconds", "position", "runsAhead", "state"]);
});

test("old response bytes stay pinned and non-replay paths perform no queue read", async () => {
  for (const deployment of [run("completed"), run("failed"), run("browser"), run("live"), run("pending", null), run("running", null)]) {
    const response = await deploymentReadResponse(deployment, async () => { throw Error("unexpected queue read"); }, limits);
    expect(JSON.stringify(response)).toBe(JSON.stringify({ success: true, deployment }));
    expect(Object.hasOwn(response, "replay")).toBe(false);
  }
  // LF-normalized SHA-256 of the GET response fixture captured on untouched 9c66e6a. Never regenerate.
  const response = await deploymentReadResponse(run("completed"), async () => [], limits);
  expect(createHash("sha256").update(JSON.stringify(response).replaceAll("\r\n", "\n")).digest("hex"))
    .toBe("77bf516761a786e30d0513374fbd21169a9e1e2f0335c0acd9aa136492cf17c4");
});

test("bounded overflow, query cap and a target that retired during the read stay Unknown", async () => {
  for (const rows of [[], Array.from({ length: 23 }, (_, i) => ({ ...run(), id: i ? `other-${i}` : "target" }))]) {
    const response = await deploymentReadResponse(run(), async () => rows, limits);
    expect(response.replay).toMatchObject({ state: "unknown", position: null, runsAhead: null, estimatedWaitSeconds: null });
  }
  const calls: number[] = [];
  await deploymentReadResponse(run(), async take => { calls.push(take); return []; }, { active: 1000, queued: 1000 });
  expect(calls).toEqual([257]);
});

test("strict replay contract round-trips all states and rejects extras or invalid numbers", async () => {
  for (const rows of [[run()], [run("running")], [], [{ ...run(), browserSubmission: {} }]]) {
    const response = await deploymentReadResponse(run(), async () => rows, limits);
    const contract: Pick<DeploymentReadResponse, "success" | "replay"> = response;
    const replay: ReplayQueueStatus = ReplayQueueStatusSchema.parse(JSON.parse(JSON.stringify(contract.replay)));
    expect(replay).toEqual(response.replay!);
    for (const extra of [{ extra: true }, { position: 0 }, { runsAhead: -1 }, { estimatedWaitSeconds: -1 }, { estimatedWaitSeconds: Infinity }, { basis: "" }, { state: "done" }]) {
      expect(ReplayQueueStatusSchema.safeParse({ ...replay, ...extra }).success).toBe(false);
    }
  }
  const replay = (await deploymentReadResponse(run(), async () => [], limits)).replay!;
  expect(ReplayQueueStatusSchema.safeParse({ ...replay, runsAhead: 0 }).success).toBe(false);
});
