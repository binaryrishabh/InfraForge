import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { digest, sha256 } from "./hash";

export interface TransitionTable {
  schema: string; first: string; last: string;
  descriptors: Record<string, { schema: string; runtime: string; [key: string]: unknown }>;
  entries: Array<{ commit: string; source: string; descriptor: string; target: string; review: string; kind?: "descriptor"; algorithm?: "host-boundary/1" | "import-boundary/1" | "launch-boundary/1" }>;
}
export function validateTransitions(table: TransitionTable, expectedHash: string) {
  if (digest(table) !== expectedHash || table.schema !== "execution-source-transitions/1") throw Error("Execution transition table changed");
  for (const [key, descriptor] of Object.entries(table.descriptors)) if (digest(descriptor) !== key || descriptor.schema !== "execution-source/2") throw Error("Historical descriptor changed");
  const mappings = new Map<string, string>();
  for (const row of table.entries) {
    if (!/^[a-f0-9]{40}$/.test(row.commit) || !/^[a-f0-9]{64}$/.test(row.source) || !table.descriptors[row.descriptor] || !table.descriptors[row.target] || !row.review) throw Error("Invalid execution transition");
    if (mappings.has(row.source) && mappings.get(row.source) !== row.target) throw Error("Ambiguous execution transition");
    mappings.set(row.source, row.target);
  }
  if (!table.entries.some(row => row.commit === table.first) || !table.entries.some(row => row.commit === table.last)) throw Error("Incomplete execution transition coverage");
  return mappings;
}
export function loadTransitions(root: string, read = (path: string) => readFileSync(path, "utf8")) {
  const folder = resolve(root, "apps/backend/executionIdentity");
  const pin = JSON.parse(read(resolve(folder, "transitionPin.json")));
  const text = read(resolve(folder, "executionTransitions.json")).replaceAll("\r\n", "\n");
  if (sha256(text) !== pin.bytes) throw Error("Execution transition bytes changed");
  const table = JSON.parse(text) as TransitionTable;
  return { table, pin, mappings: validateTransitions(table, pin.digest) };
}
const cached = new Map<string, Map<string, string>>();
export function compatibleTransition(recorded: string, current: string, root: string) {
  if (recorded === current) return true;
  try {
    if (!cached.has(root)) cached.set(root, loadTransitions(root).mappings);
    return cached.get(root)!.get(recorded) === current;
  } catch { return false; }
}
