import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest } from "../apps/backend/executionIdentity/hash";
import type { History, TransitionTable } from "../apps/backend/executionIdentity/transitions";

// Independent of transitionPin and the refresh writer. Never regenerate this
// inventory when appending history; a retarget may change only the target.
const anchorDigest = "aaf26113c7ea2bc726eb8239af353c900d42647a78c13a6fcfc7d55b0f9b27c1";
export function assertHistoricalPreservation(table: TransitionTable, history: History, root = resolve(import.meta.dir, "..")) {
  const anchor = JSON.parse(readFileSync(resolve(root, "docs/reality/execution-history-anchor.json"), "utf8")) as {
    schema: string; first: string; last: string; rows: string[]; snapshots: string[]; descriptors: string[];
  };
  if (digest(anchor) !== anchorDigest) throw Error("Independent history anchor changed");
  if (table.first !== anchor.first || table.last !== anchor.last || table.entries.length < anchor.rows.length) throw Error("Anchored history removed");
  for (const [index, hash] of anchor.rows.entries()) {
    const { target: _target, ...row } = table.entries[index]!;
    if (digest(row) !== hash) throw Error("Anchored history changed or reordered");
    if (digest(history.trees[row.commit]) !== anchor.snapshots[index]) throw Error("Anchored snapshot changed");
  }
  for (const hash of anchor.descriptors) if (!table.descriptors[hash] || digest(table.descriptors[hash]) !== hash) throw Error("Anchored descriptor changed");
}
