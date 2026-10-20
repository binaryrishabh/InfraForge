import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { digest, ordered, sha256 } from "../../apps/backend/executionIdentity/hash";
import { MerkleBuilder, nodeHash, readMerklePack } from "../../apps/backend/executionIdentity/merkle";
import type { MerkleNode, NodePack } from "../../apps/backend/executionIdentity/merkle";
import { loadTransitions, validateTransitions } from "../../apps/backend/executionIdentity/transitions";
import type { History, TransitionTable } from "../../apps/backend/executionIdentity/transitions";
import { encodeTransitionStore } from "../transition-store";

const root = resolve(import.meta.dir, "../..");
const descriptor = { schema: "execution-source/2", runtime: "bun-1.3.14", files: [["fixture.ts", "a".repeat(64)]] };
const source = digest(descriptor), current = { ...descriptor, files: [["fixture.ts", "b".repeat(64)]] }, target = digest(current), commit = "1".repeat(40);
const table: TransitionTable = { schema: "execution-source-transitions/1", first: commit, last: commit,
  descriptors: { [source]: descriptor, [target]: current }, entries: [{ commit, source, descriptor: source, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Synthetic storage fixture" }] };
const text = "export const value = 1;\n", textHash = sha256(text);
const history: History = { blobs: { [textHash]: text }, trees: { [commit]: { "fixture.ts": textHash } } };
const encoded = encodeTransitionStore(table, history);
function read(result = encoded) {
  return (path: string) => path.endsWith("transitionPin.json") ? JSON.stringify(result.pin) : path.endsWith("executionTransitions.json") ? result.manifestText : result.bytes;
}
const sort = (pack: NodePack) => pack.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

test("tagged containers retain scalar types, object order, array order and reference-like values", () => {
  const builder = new MerkleBuilder(), input = { z: [null, false, 0, "0", ["ref", "data"]], a: { constructor: "data", __proto__: null } };
  const root = builder.object(input), reverse = builder.object({ a: input.a, z: input.z });
  expect(reverse).toBe(root);
  expect(readMerklePack(builder.pack(), [root]).expand(root)).toEqual(input);
  expect(builder.object({ ...input, z: [...input.z].reverse() })).not.toBe(root);
});

test("text normalizes LF and shares chunks after a local edit", () => {
  const builder = new MerkleBuilder(), text = Array.from({ length: 4000 }, (_, i) => `source line ${i}: ${i % 97}\n`).join("");
  const root = builder.text(text.replaceAll("\n", "\r\n")), before = new Set(builder.nodes.keys());
  const changed = text.replace("source line 2000", "edited source line 2000"), next = builder.text(changed);
  const decoded = readMerklePack(builder.pack(), [root, next]);
  expect(decoded.expand(root)).toBe(text); expect(decoded.expand(next)).toBe(changed);
  expect([...builder.nodes.keys()].filter(hash => !before.has(hash)).length).toBeLessThan(8);
});

test("manifest, pack and history round trip deterministically", () => {
  const restored = loadTransitions(root, read());
  expect(restored.table).toEqual(table); expect(restored.history()).toEqual(history);
  const again = encodeTransitionStore(restored.table, restored.history());
  expect(again.bytes.equals(encoded.bytes)).toBe(true);
  expect(again.manifestText).toBe(encoded.manifestText); expect(again.pin).toEqual(encoded.pin);
  expect(encoded.bytes[9]).toBe(255);
  expect(loadTransitions(root, path => { const data = read()(path); return typeof data === "string" ? data.replaceAll("\n", "\r\n") : data; }).table).toEqual(table);
});

test("missing, duplicate, unknown, altered and wrongly hashed nodes fail independently of pins", () => {
  const builder = new MerkleBuilder(), root = builder.object({ a: [1, 2], b: { value: true } }), pack = builder.pack();
  const cases: NodePack[] = [pack.slice(1), sort([...pack, pack[0]!]), sort([...pack, ["f".repeat(64), ["chunk", "extra"]]])];
  const altered = structuredClone(pack); altered[0]![1] = ["chunk", "altered"]; cases.push(altered);
  const unknown = structuredClone(pack); unknown[0]![1] = ["unknown", []] as unknown as MerkleNode; cases.push(unknown);
  for (const copy of cases) expect(() => readMerklePack(copy, [root])).toThrow();
});

test("cycles, dangling references, duplicate keys and unknown reference tags fail", () => {
  const hash = "a".repeat(64);
  expect(() => readMerklePack([[hash, ["array", [["ref", hash]]]]], [hash])).toThrow("Cyclic");
  expect(() => readMerklePack([[hash, ["array", [["ref", "b".repeat(64)]]]]], [hash])).toThrow("Dangling");
  for (const node of [["object", [["a", 1], ["a", 2]]], ["array", [["unknown", hash]]], ["chunk", "a\r\nb"]] as unknown as MerkleNode[]) {
    const key = nodeHash(node); expect(() => readMerklePack([[key, node]], [key])).toThrow();
  }
  const wrongText: MerkleNode = ["text", [hash]], root = nodeHash(wrongText);
  expect(() => readMerklePack(sort([[hash, ["array", []]], [root, wrongText]]), [root])).toThrow();
});

test("byte, root, index, snapshot coverage and required snapshot references are pinned", () => {
  for (const field of ["bytes", "root", "pack", "index", "digest"] as const) {
    const result = { ...encoded, pin: { ...encoded.pin, [field]: "0".repeat(64) } };
    expect(() => loadTransitions(root, read(result))).toThrow();
  }
  const result = { ...encoded, manifest: structuredClone(encoded.manifest), pin: { ...encoded.pin } };
  delete result.manifest.snapshots[commit];
  result.manifestText = JSON.stringify(ordered(result.manifest), null, 2) + "\n";
  result.pin.bytes = sha256(result.manifestText); result.pin.root = digest(["execution-transition-manifest/2", result.manifest]);
  expect(() => loadTransitions(root, read(result))).toThrow();
  const broken = { ...encoded, bytes: gzipSync("[]\n"), pin: { ...encoded.pin } };
  broken.pin.pack = sha256(broken.bytes.toString("base64"));
  expect(() => loadTransitions(root, read(broken))).toThrow("Dangling");
});

test("duplicate rows, conflicting mappings, unknown algorithms, descriptor drift and coverage drift fail", () => {
  const mutations = [
    (copy: TransitionTable) => copy.entries.push({ ...copy.entries[0]! }),
    (copy: TransitionTable) => copy.entries.push({ ...copy.entries[0]!, commit: "2".repeat(40), target: source }),
    (copy: TransitionTable) => { copy.entries[0]!.algorithm = "unknown" as "analysis-boundary/1"; },
    (copy: TransitionTable) => { copy.descriptors[source]!.runtime = "changed"; },
    (copy: TransitionTable) => { copy.last = "3".repeat(40); },
    (copy: TransitionTable) => { copy.entries.push({ ...copy.entries[0]!, commit: "2".repeat(40), source: target, descriptor: target, target: source }); },
  ];
  for (const mutate of mutations) { const copy = structuredClone(table); mutate(copy); expect(() => validateTransitions(copy, digest(copy))).toThrow(); }
});

test("all pre-migration rows, descriptors and complete snapshots retain their original digests", () => {
  const proof = JSON.parse(readFileSync(resolve(root, "docs/reality/transition-storage-migration.json"), "utf8"));
  expect(proof.legacyTableDigest).toBe("0306da915fab8a458f13eebf9e722bb887251c8708b8aee8497dcf7a096b7e65");
  const store = loadTransitions(root), history = store.history();
  expect(proof.rows).toHaveLength(42); expect(proof.descriptors).toHaveLength(28); expect(proof.snapshots).toHaveLength(42);
  for (const [commit, hash] of proof.rows) {
    const row = store.table.entries.find(row => row.commit === commit)!;
    const { target: _target, ...original } = row;
    expect(digest(original)).toBe(hash);
  }
  for (const hash of proof.descriptors) expect(digest(store.table.descriptors[hash])).toBe(hash);
  for (const [commit, hash] of proof.snapshots) expect(digest(history.trees[commit])).toBe(hash);
  for (const [hash, text] of Object.entries(history.blobs)) expect(sha256(text)).toBe(hash);
}, 30000);

test("a synthetic future file edit adds only unique nodes and a small manifest delta", () => {
  const first = encodeTransitionStore(table, history), future = structuredClone(table), snapshots = structuredClone(history);
  const next = { ...current, files: [["fixture.ts", "c".repeat(64)]] }, nextHash = digest(next), nextCommit = "2".repeat(40);
  future.descriptors[nextHash] = next;
  future.entries.push({ ...future.entries[0]!, commit: nextCommit, source: target, descriptor: target, target: nextHash });
  for (const row of future.entries) row.target = nextHash;
  snapshots.trees[nextCommit] = snapshots.trees[commit]!;
  const second = encodeTransitionStore(future, snapshots), one = loadTransitions(root, read(first)), two = loadTransitions(root, read(second));
  for (const [hash, node] of one.pack.nodes) expect(two.pack.nodes.get(hash)).toEqual(node);
  expect(two.pack.nodes.size - one.pack.nodes.size).toBe(3);
  expect(Buffer.byteLength(second.manifestText) - Buffer.byteLength(first.manifestText)).toBeLessThan(1200);
});
