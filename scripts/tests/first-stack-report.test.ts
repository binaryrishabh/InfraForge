import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { diagnosticJournal } from "../../packages/simulation/src/firstStack/journal";

test("first-stack report source review binds its data boundary and acceptance", () => {
  const review = JSON.parse(readFileSync("docs/reality/first-stack-report-source-review.json", "utf8"));
  expect(review.schema).toBe("first-stack-report-source-review/1");
  expect(review.files.length).toBe(11); expect(review.acceptance.length).toBe(3);
  for (const row of [...review.files, ...review.acceptance]) expect(sourceHash(readFileSync(row.path, "utf8"))).toBe(row.hash);
});

test("diagnostic selection remains bounded and every selected ID addresses original journal bytes", () => {
  const journal = diagnosticJournal();
  for (let i = 0; i < 200; i++) journal.record({ atUs: i, kind: "test", resource: "fixture", detail: { index: i } });
  const selected = journal.selection(), lines = journal.content().trim().split("\n");
  expect(selected.events.length).toBe(128); expect(selected.omitted).toBe(72);
  expect(journal.measure()).toMatchObject({ observed: 200, retained: 200, omitted: 0, complete: true });
  for (const { id, ...event } of selected.events) expect(event).toEqual(JSON.parse(lines[Number(id.split(":")[1])]!));
  selected.events[0]!.detail.index = -1;
  expect(journal.selection().events[0]!.detail.index).toBe(0);
  const empty = diagnosticJournal(0); empty.record({ atUs: 1, kind: "test", resource: "fixture", detail: {} });
  expect(empty.selection().journalOmitted).toBe(1); expect(empty.selection().events).toEqual([]);
});
