import { expect, test } from "bun:test";
import { firstStackLimits } from "@infraforge/contracts/first-stack";
import { resolveWorkload, identityTransform, recordedApplicationInput } from "../firstStack/workload";
import { readImportContext } from "../firstStack/importStream";
import { firstStackFixture } from "./firstStackFixture";
import { verticalFixture } from "../../../packages/simulation/tests/networkFixture";
import { createNetworkRuntime } from "../../../packages/simulation/src/model2/network/run";

const header = { schema: "infraforge-first-stack-schedule/1", unit: "us", durationUs: 1000, origin: "observed-recording", provenance: "explicit test recording" };
const rows = [{ id: "b", atUs: 10, operation: "read", intendedAtUs: 9, sentAtUs: 10, generatorLost: false }, { id: "a", atUs: 10, operation: "read" }];
const params = () => ({ schema: "infraforge-first-stack-parameters/1", rows: rows.map(r => ({ id: r.id, plan: "read-plan", keys: ["hot"] })) });
const jsonl = (lines: unknown[], newline = "\n") => lines.map(x => JSON.stringify(x)).join(newline) + newline;
async function* chunks(text: string | Uint8Array, size = 4096) { const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text; for (let at = 0; at < bytes.length; at += size) yield bytes.subarray(at, at + size); }
const options = () => ({ owner: "owner", sidecar: firstStackFixture().sidecar, parameters: params() });

test("canonical LF/CRLF, byte chunks, ties and parameters have identical resolved identity", async () => {
  const lf = await resolveWorkload(chunks(jsonl([header, ...rows]), 1), options());
  const crlf = await resolveWorkload(chunks(jsonl([header, ...rows], "\r\n"), 7), options());
  const reversed = { ...options(), parameters: { ...params(), rows: params().rows.reverse() } };
  const tieOrder = await resolveWorkload(chunks(jsonl([header, ...[...rows].reverse()])), reversed);
  expect(crlf).toEqual(lf); expect(tieOrder).toEqual(lf);
  expect(lf.rows.map(r => r.id)).toEqual(["a", "b"]);
  expect(lf.rows.map(r => r.keys)).toEqual([["hot"], ["hot"]]);
  expect(lf.unknown).toContain("Missing observed send times");
  expect(lf.application.origin).toBe("authored"); expect(lf.header.origin).toBe("observed-recording");
});
test("authored spacing remains authored and changes identity independently from demand provenance", async () => {
  const a = await resolveWorkload(chunks(jsonl([header, ...rows])), options());
  const b = await resolveWorkload(chunks(jsonl([{ ...header, origin: "authored-schedule" }, ...rows])), options());
  expect(b.header.origin).toBe("authored-schedule"); expect(b.application).toEqual(a.application);
  expect(b.identity).not.toBe(a.identity);
});
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
test("malformed units, times, operations, duplicate IDs and unsupported payloads refuse", async () => {
  for (const lines of [
    [{ ...header, unit: "ms" }, ...rows], [{ ...header, durationUs: 0 }, ...rows],
    [header, rows[0], { ...rows[1], atUs: 9 }], [header, { ...rows[0], atUs: 1001 }],
    [header, { ...rows[0], atUs: 0.5 }], [header, rows[0], rows[0]],
    [header, { ...rows[0], operation: "unknown" }], [header, { ...rows[0], body: "unsupported" }],
    [header, { ...rows[0], deadlineUs: 10 }], [header, { ...rows[0], generatorLost: true }],
  ]) await expect(resolveWorkload(chunks(jsonl(lines)), options())).rejects.toThrow();
});
test("key/plan coverage, key bounds, duplicate mappings and conflicting bytes refuse atomically", async () => {
  for (const change of ["missing", "extra", "duplicate", "key", "plan", "keys", "bytes"] as const) {
    const p = params();
    if (change === "missing") p.rows.pop();
    if (change === "extra") p.rows.push({ id: "other", plan: "read-plan", keys: ["hot"] });
    if (change === "duplicate") p.rows[1]!.id = p.rows[0]!.id;
    if (change === "key") p.rows[0]!.keys = ["outside"];
    if (change === "plan") p.rows[0]!.plan = "unknown";
    if (change === "keys") p.rows[0]!.keys = [];
    if (change === "bytes") Object.assign(p.rows[0]!, { responseBytes: 10 });
    await expect(resolveWorkload(chunks(jsonl([header, { ...rows[0], responseBytes: 2 }, rows[1]])), { ...options(), parameters: p })).rejects.toThrow();
  }
});
test("missing bytes stay Unknown until explicitly mapped; explicit zero is retained", async () => {
  const o = options(); o.sidecar.operations[0]!.requestBytes = null;
  await expect(resolveWorkload(chunks(jsonl([header, ...rows])), o)).rejects.toThrow("Missing bytes");
  const schedule = await resolveWorkload(chunks(jsonl([header, ...rows.map(r => ({ ...r, requestBytes: 0 }))])), o);
  expect(schedule.rows.map(r => r.requestBytes)).toEqual([0, 0]);
});
test("explicit transforms retain integer microseconds and immutable transform identity", async () => {
  const text = jsonl([header, ...rows]);
  const base = await resolveWorkload(chunks(text), options());
  const transform = { ...identityTransform, timeScale: { numerator: 2, denominator: 1 }, shiftUs: 3 };
  const changed = await resolveWorkload(chunks(text), { ...options(), transform });
  expect(changed.rows[0]!.atUs).toBe(23); expect(changed.header.durationUs).toBe(2003);
  expect(changed.scheduleHash).toBe(base.scheduleHash); expect(changed.identity).not.toBe(base.identity);
  await expect(resolveWorkload(chunks(text), { ...options(), transform: { ...transform, timeScale: { numerator: 1, denominator: 3 } } })).rejects.toThrow("integer microseconds");
  await expect(resolveWorkload(chunks(text), { ...options(), transform: { ...transform, shiftUs: firstStackLimits.durationUs } })).rejects.toThrow("horizon");
});
test("byte and line limits fire before JSON parse; malformed UTF-8 and JSON refuse", async () => {
  await expect(resolveWorkload(chunks(new Uint8Array(firstStackLimits.scheduleBytes + 1), firstStackLimits.scheduleBytes + 1), options())).rejects.toThrow("Schedule byte");
  await expect(resolveWorkload(chunks("x".repeat(firstStackLimits.lineBytes + 1)), options())).rejects.toThrow("line byte");
  await expect(resolveWorkload(chunks(new Uint8Array([0xff, 10])), options())).rejects.toThrow("Malformed UTF-8");
  await expect(resolveWorkload(chunks("{broken}\n"), options())).rejects.toThrow("Malformed JSON");
  await expect(resolveWorkload(chunks(jsonl([header]) + "\n"), options())).rejects.toThrow("Empty JSONL");
});
test("streamed row budget stops at first excess row and cancellation returns no partial result", async () => {
  async function* many() {
    yield new TextEncoder().encode(jsonl([header]));
    for (let i = 0; i <= firstStackLimits.rows; i++) yield new TextEncoder().encode(jsonl([{ id: String(i), atUs: 0, operation: "read" }]));
    throw Error("Read past bounded input");
  }
  await expect(resolveWorkload(many(), options())).rejects.toThrow("row budget");
  const abort = new AbortController();
  async function* cancel() { yield new TextEncoder().encode(jsonl([header, rows[0]])); abort.abort(); yield new TextEncoder().encode(jsonl([rows[1]])); }
  await expect(resolveWorkload(cancel(), { ...options(), signal: abort.signal })).rejects.toThrow("cancelled");
});
test("capability preflight can deny before reading and resolved denial returns no schedule", async () => {
  let read = 0, calls = 0;
  async function* source() { read++; yield new TextEncoder().encode(jsonl([header, ...rows])); }
  await expect(resolveWorkload(source(), { ...options(), capability: () => { throw Error("Denied"); } })).rejects.toThrow("Denied");
  expect(read).toBe(0);
  await expect(resolveWorkload(source(), { ...options(), capability: (...args) => { if (++calls === 2) throw Error("Resolved denied"); return { allowed: true, revision: "test", reason: "test", allowance: { kind: "no-commercial-cap" } }; } })).rejects.toThrow("Resolved denied");
  expect(read).toBe(1);
});
test("HTTP import framing bounds parameters before parse and preserves remaining schedule bytes", async () => {
  const context = { infrastructureId: "00000000-0000-4000-8000-000000000001", expectedDesignUpdatedAt: "2026-10-20T00:00:00.000Z", parameters: params() };
  const text = jsonl([context, header, ...rows]);
  const framed = await readImportContext(chunks(text, 7));
  expect(framed.context).toEqual(context);
  expect((await resolveWorkload(framed.schedule, options())).rows).toHaveLength(2);
  await expect(readImportContext(chunks("x".repeat(firstStackLimits.parameterBytes + 1025)))).rejects.toThrow("before parsing");
});
