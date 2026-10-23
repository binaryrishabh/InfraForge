import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadTransitions, validateTransitions } from "../../apps/backend/executionIdentity/transitions";
import { digest } from "../../apps/backend/executionIdentity/hash";
import { assertHistoricalPreservation } from "../history-preservation";

test("independent history anchor rejects deletion, replacement, reordering and snapshot drift even after repinning", () => {
  const { table, history: readHistory } = loadTransitions(resolve(import.meta.dir, "../..")), history = readHistory();
  assertHistoricalPreservation(table, history);
  for (const mutate of [
    (copy: typeof table) => { copy.entries.splice(1, 1); },
    (copy: typeof table) => { copy.entries[1]!.review += " altered"; },
    (copy: typeof table) => { [copy.entries[1], copy.entries[2]] = [copy.entries[2]!, copy.entries[1]!]; },
  ]) {
    const copy = structuredClone(table); mutate(copy);
    for (const hash of Object.keys(copy.descriptors)) if (!copy.entries.some(row => row.descriptor === hash || row.target === hash)) delete copy.descriptors[hash];
    // The ordinary pin can be regenerated; the independent anchor cannot.
    validateTransitions(copy, digest(copy));
    expect(() => assertHistoricalPreservation(copy, history)).toThrow("Anchored history");
  }
  const changed = structuredClone(history);
  delete changed.trees[table.entries[0]!.commit]![Object.keys(changed.trees[table.entries[0]!.commit]!)[0]!];
  expect(() => assertHistoricalPreservation(table, changed)).toThrow("Anchored snapshot");
  const appended = structuredClone(table), snapshots = structuredClone(history);
  const row = { ...appended.entries.at(-1)!, commit: "e".repeat(40) };
  appended.entries.push(row); snapshots.trees[row.commit] = snapshots.trees[table.entries.at(-1)!.commit]!;
  expect(() => assertHistoricalPreservation(appended, snapshots)).not.toThrow();
}, 30000);
