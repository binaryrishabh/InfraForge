import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { digest, lf, ordered, sha256 } from "./hash";
import { readMerklePack } from "./merkle";

export interface TransitionTable {
  schema: string; first: string; last: string;
  descriptors: Record<string, { schema: string; runtime: string; [key: string]: unknown }>;
  entries: Array<{ commit: string; source: string; descriptor: string; target: string; review: string; kind?: "descriptor"; algorithm?: "host-boundary/1" | "import-boundary/1" | "launch-boundary/1" | "analysis-boundary/1" | "isolation-boundary/1" | "declared-host-boundary/1" | "qualification-boundary/1" }>;
}
export function validateTransitions(table: TransitionTable, expectedHash: string) {
  if (digest(table) !== expectedHash || table.schema !== "execution-source-transitions/1") throw Error("Execution transition table changed");
  for (const [key, descriptor] of Object.entries(table.descriptors)) if (digest(descriptor) !== key || descriptor.schema !== "execution-source/2") throw Error("Historical descriptor changed");
  const mappings = new Map<string, string>();
  const commits = new Set<string>();
  for (const row of table.entries) {
    if (!/^[a-f0-9]{40}$/.test(row.commit) || !/^[a-f0-9]{64}$/.test(row.source) || !table.descriptors[row.descriptor] || !table.descriptors[row.target] || !row.review) throw Error("Invalid execution transition");
    if (mappings.has(row.source) && mappings.get(row.source) !== row.target) throw Error("Ambiguous execution transition");
    if (commits.has(row.commit)) throw Error("Duplicate execution transition commit");
    if (row.kind !== undefined && row.kind !== "descriptor" || row.algorithm !== undefined && !["host-boundary/1", "import-boundary/1", "launch-boundary/1", "analysis-boundary/1", "isolation-boundary/1", "declared-host-boundary/1", "qualification-boundary/1"].includes(row.algorithm)) throw Error("Unknown execution transition algorithm");
    commits.add(row.commit);
    mappings.set(row.source, row.target);
  }
  if (!table.entries.some(row => row.commit === table.first) || !table.entries.some(row => row.commit === table.last)) throw Error("Incomplete execution transition coverage");
  const required = [...new Set(table.entries.flatMap(row => [row.descriptor, row.target]))].sort();
  if (digest(required) !== digest(Object.keys(table.descriptors).sort())) throw Error("Unknown historical descriptor");
  for (const source of mappings.keys()) {
    const seen = new Set<string>(); let next: string | undefined = source;
    while (next && mappings.has(next)) {
      if (seen.has(next)) throw Error("Cyclic execution mappings");
      seen.add(next); next = mappings.get(next);
    }
  }
  return mappings;
}
export interface TransitionManifest extends Omit<TransitionTable, "schema" | "descriptors"> {
  schema: "execution-source-transitions/2";
  descriptors: Record<string, string>;
  snapshots: Record<string, string>;
}
export interface History { blobs: Record<string, string>; trees: Record<string, Record<string, string>> }
export function loadTransitions(root: string, read: (path: string) => string | Buffer = path => readFileSync(path)) {
  const folder = resolve(root, "apps/backend/executionIdentity");
  const pin = JSON.parse(read(resolve(folder, "transitionPin.json")).toString());
  const text = lf(read(resolve(folder, "executionTransitions.json")).toString());
  if (sha256(text) !== pin.bytes) throw Error("Execution transition bytes changed");
  const manifest = JSON.parse(text) as TransitionManifest;
  if (digest(Object.keys(manifest).sort()) !== digest(["schema", "first", "last", "entries", "descriptors", "snapshots"].sort()) || JSON.stringify(ordered(manifest), null, 2) + "\n" !== text) throw Error("Noncanonical execution transition manifest");
  if (manifest.schema !== "execution-source-transitions/2" || pin.schema !== "execution-transition-pin/2" || digest(["execution-transition-manifest/2", manifest]) !== pin.root) throw Error("Execution transition manifest changed");
  const bytes = read(resolve(folder, "executionNodes.json.gz"));
  if (!Buffer.isBuffer(bytes) || sha256(bytes.toString("base64")) !== pin.pack) throw Error("Execution Merkle pack bytes changed");
  const pack = readMerklePack(JSON.parse(gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }).toString()), [...Object.values(manifest.descriptors), ...Object.values(manifest.snapshots)]);
  if (pack.index !== pin.index) throw Error("Execution Merkle index changed");
  if (digest(Object.keys(manifest.snapshots).sort()) !== digest(manifest.entries.map(row => row.commit).sort())) throw Error("Historical transition coverage changed");
  const { snapshots: _snapshots, ...fields } = manifest;
  const table = { ...fields, schema: "execution-source-transitions/1", descriptors: Object.fromEntries(Object.entries(manifest.descriptors).map(([hash, ref]) => [hash, pack.expand(ref)])) } as TransitionTable;
  const mappings = validateTransitions(table, pin.digest);
  function history(): History {
    const blobs: Record<string, string> = {}, trees: History["trees"] = {};
    for (const [commit, ref] of Object.entries(manifest.snapshots)) {
      const files: Record<string, string> = {};
      const walk = (value: unknown, prefix: string) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid snapshot directory");
        for (const [name, child] of Object.entries(value)) {
          if (!name || name === "." || name === ".." || /[\\/]/.test(name)) throw Error("Invalid snapshot path");
          const path = prefix + name;
          if (typeof child === "string") { const hash = sha256(child); blobs[hash] = child; files[path] = hash; }
          else walk(child, path + "/");
        }
      };
      walk(pack.expand(ref), ""); trees[commit] = files;
    }
    return { blobs, trees };
  }
  return { table, pin, mappings, manifest, pack, history };
}
const cached = new Map<string, Map<string, string>>();
export function compatibleTransition(recorded: string, current: string, root: string) {
  if (recorded === current) return true;
  try {
    if (!cached.has(root)) cached.set(root, loadTransitions(root).mappings);
    return cached.get(root)!.get(recorded) === current;
  } catch { return false; }
}
