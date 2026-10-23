import { historicalSlice } from "../historical-slice-reviews";
import { expect, test } from "bun:test";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { diagnosticJournal } from "../../packages/simulation/src/firstStack/journal";

test("first-stack report historical source review binds its data boundary and acceptance", () => {
  const { review, read: historicalSource } = historicalSlice("docs/reality/first-stack-report-source-review.json");
  expect(review.schema).toBe("first-stack-report-source-review/1");
  expect(review.files.length).toBe(11); expect(review.acceptance!.length).toBe(5);
  for (const row of [...review.files, ...(review.acceptance ?? [])]) expect(sourceHash(historicalSource(row.path))).toBe(row.hash!);
});

test("diagnostic selection remains bounded and every selected ID addresses original journal bytes", () => {
  const journal = diagnosticJournal();
  for (let i = 0; i < 200; i++) journal.record({ atUs: i, kind: "test", resource: "fixture", detail: { index: i } });
  for (let root = 0; root < 3; root++) for (let i = 0; i < 40; i++) journal.record({ atUs: 200 + root * 40 + i, kind: "caller-offered", resource: "$caller",
    work: { rootId: JSON.stringify(["root", "recorded", root]), callId: `call-${root}`, attempt: 0, operation: "test", offeredAt: 200 }, detail: {} });
  const selected = journal.selection(), lines = journal.content().trim().split("\n");
  expect(selected.events.length).toBe(128); expect(selected.omitted).toBe(192);
  expect(selected.roots).toHaveLength(3);
  for (const root of selected.roots) expect(selected.events.filter(e => e.work?.rootId === root)).toHaveLength(32);
  expect(journal.measure()).toMatchObject({ observed: 320, retained: 320, omitted: 0, complete: true });
  for (const { id, ...event } of selected.events) expect(event).toEqual(JSON.parse(lines[Number(id.split(":")[1])]!));
  selected.events[0]!.detail.index = -1;
  expect(journal.selection().events[0]!.detail.index).toBe(0);
  const empty = diagnosticJournal(0); empty.record({ atUs: 1, kind: "test", resource: "fixture", detail: {} });
  expect(empty.selection().journalOmitted).toBe(1); expect(empty.selection().events).toEqual([]);
});
