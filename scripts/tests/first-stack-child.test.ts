import { expect, test } from "bun:test";
import { resolveWorkload, recordedApplicationInput } from "../../apps/backend/firstStack/workload";
import { firstStackFixture } from "../../apps/backend/tests/firstStackFixture";
import { verticalFixture } from "../../packages/simulation/tests/networkFixture";
import { createNetworkRuntime } from "../../packages/simulation/src/model2/network/run";

const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: 1000, origin: "observed-recording", provenance: "explicit test recording" };
const rows = [{ id: "b", atUs: 10, operation: "read", intendedAtUs: 9, sentAtUs: 10, generatorLost: false }, { id: "a", atUs: 10, operation: "read" }];
const params = () => ({ schema: "infraforge-first-stack-parameters/1", rows: rows.map(r => ({ id: r.id, plan: "read-plan", keys: ["hot"] })) });
const jsonl = (lines: unknown[], newline = "\n") => lines.map(x => JSON.stringify(x)).join(newline) + newline;
async function* chunks(text: string | Uint8Array, size = 4096) { const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text; for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size); }
const options = () => ({ owner: "owner", sidecar: firstStackFixture().sidecar, parameters: params() });

test("exact same-time hot keys survive the typed application adapter and child copy without fallback", async () => {
  const o = options(); o.sidecar.operations[0]!.id = "light";
  const schedule = await resolveWorkload(chunks(jsonl([header, ...rows.map(row => ({ ...row, operation: "light" }))])), o);
  const input = verticalFixture({ horizon: 20000 });
  input.arrivals = [{ id: "recorded", kind: "trace", trace: { schema: "infraforge-arrivals/1", unit: "us", durationUs: 1000,
    provenance: "test recording", rows: schedule.rows.map(({ id, atUs, operation }) => ({ id, atUs, operation })) } }];
  const delivered: Array<{ root: string; call: string; parent?: string; key: string }> = [];
  const runtime = createNetworkRuntime(input, { resource: () => undefined, receive(target, work) {
    if (target === "lb" && JSON.parse(work.rootId)[0] === "root") {
      work.message = { request: recordedApplicationInput(schedule, JSON.parse(work.rootId)[2]) };
    }
    if (target === "dep" && work.message) delivered.push({ root: work.rootId, call: work.callId, parent: work.parentCallId,
      key: (work.message.request as { key: string }).key });
    return undefined;
  } });
  runtime.advanceTo(runtime.horizon);
  expect(delivered).toHaveLength(2);
  expect(delivered.map(row => row.key)).toEqual(["hot", "hot"]);
  expect(new Set(delivered.map(row => row.root)).size).toBe(2);
  expect(delivered.every(row => row.parent && row.call !== row.parent)).toBe(true);
  expect(runtime.evidence().counts.completed).toBe(2);
  expect(schedule.rows.map(row => row.keys)).toEqual([["hot"], ["hot"]]);
  expect(() => recordedApplicationInput(schedule, "absent")).toThrow("Unknown recorded row");
});
