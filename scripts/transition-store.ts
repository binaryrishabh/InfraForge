import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { digest, lf, ordered, sha256 } from "../apps/backend/executionIdentity/hash";
import { MerkleBuilder, readMerklePack } from "../apps/backend/executionIdentity/merkle";
import { loadTransitions, validateTransitions } from "../apps/backend/executionIdentity/transitions";
import type { History, TransitionManifest, TransitionTable } from "../apps/backend/executionIdentity/transitions";

export const folder = "apps/backend/executionIdentity/";
export function encodeTransitionStore(table: TransitionTable, history: History) {
  validateTransitions(table, digest(table));
  if (digest(Object.keys(history.trees).sort()) !== digest(table.entries.map(row => row.commit).sort())) throw Error("Historical transition coverage changed");
  const builder = new MerkleBuilder(), texts = new Map<string, string>();
  const text = (hash: string) => {
    if (!texts.has(hash)) {
      const source = history.blobs[hash];
      if (source === undefined || source !== lf(source) || sha256(source) !== hash) throw Error("Historical execution text changed");
      texts.set(hash, builder.text(source));
    }
    return texts.get(hash)!;
  };
  const snapshots = Object.fromEntries(Object.entries(history.trees).sort().map(([commit, files]) => {
    interface Directory { [name: string]: Directory | string }
    const root: Directory = Object.create(null) as Directory;
    for (const [path, hash] of Object.entries(files).sort()) {
      const names = path.split("/"); let dir = root;
      for (const name of names.slice(0, -1)) {
        if (!name || name === "." || name === ".." || name.includes("\\")) throw Error("Invalid snapshot path");
        if (typeof dir[name] === "string") throw Error("Conflicting snapshot path");
        dir = (dir[name] ??= Object.create(null)) as Directory;
      }
      const name = names.at(-1)!;
      if (!name || name === "." || name === ".." || name.includes("\\") || dir[name] !== undefined) throw Error("Conflicting snapshot path");
      dir[name] = text(hash);
    }
    const directory = (dir: Directory): string => builder.add(["object", Object.keys(dir).sort().map(key => [key, ["ref", typeof dir[key] === "string" ? dir[key] : directory(dir[key]!) ] as ["ref", string]])]);
    return [commit, directory(root)];
  }));
  const descriptors = Object.fromEntries(Object.entries(table.descriptors).sort().map(([hash, descriptor]) => [hash, builder.object(descriptor)]));
  const manifest: TransitionManifest = { schema: "execution-source-transitions/2", first: table.first, last: table.last, entries: table.entries, descriptors, snapshots };
  const pack = builder.pack();
  const decoded = readMerklePack(pack, [...Object.values(descriptors), ...Object.values(snapshots)]);
  for (const [hash, ref] of Object.entries(descriptors)) if (digest(decoded.expand(ref)) !== hash) throw Error("Descriptor does not round trip");
  const bytes = gzipSync(JSON.stringify(pack) + "\n", { level: 9 }); bytes[9] = 255;
  const manifestText = JSON.stringify(ordered(manifest), null, 2) + "\n";
  const pin = { schema: "execution-transition-pin/2", digest: digest(table), bytes: sha256(manifestText),
    root: digest(["execution-transition-manifest/2", manifest]), pack: sha256(bytes.toString("base64")), index: decoded.index };
  return { manifest, manifestText, bytes, pin, nodes: pack.length };
}
export function writeTransitionStore(root: string, table: TransitionTable, history: History) {
  const result = encodeTransitionStore(table, history);
  writeFileSync(resolve(root, folder + "executionNodes.json.gz"), result.bytes);
  writeFileSync(resolve(root, folder + "executionTransitions.json"), result.manifestText);
  writeFileSync(resolve(root, folder + "transitionPin.json"), JSON.stringify(result.pin, null, 2) + "\n");
  return { nodes: result.nodes, bytes: result.bytes.length + Buffer.byteLength(result.manifestText) };
}

// A storage-growth experiment, not a new execution/replay approval. The next
// descriptor changes one file hash; its previous target gets a real full snapshot.
export function measureTransitionDelta(root: string) {
  const store = loadTransitions(root), table = structuredClone(store.table), history = store.history();
  const source = table.entries[0]!.target, prior = table.descriptors[source]!, next = structuredClone(prior);
  const path = "packages/simulation/src/model2/composition/token-bucket.ts";
  const files = next.files as [string, string][], file = files.find(([name]) => name === path);
  if (!file) throw Error("Missing synthetic growth fixture file");
  file[1] = digest(["synthetic-future-file-edit/1", file[1]]);
  const target = digest(next), commit = "f".repeat(40);
  if (history.trees[commit]) throw Error("Synthetic growth commit conflicts with history");
  const paths = [...new Set([...(prior.files as [string, string][]).map(([path]) => path), "package.json", "bun.lock", "bunfig.toml",
    ...["apps/backend", "apps/web", "packages/catalog", "packages/contracts", "packages/domain", "packages/simulation"].map(path => path + "/package.json")])];
  history.trees[commit] = Object.fromEntries(paths.map(path => {
    const text = lf(readFileSync(resolve(root, path), "utf8")), hash = sha256(text); history.blobs[hash] = text; return [path, hash];
  }));
  table.descriptors[target] = next;
  table.entries.push({ commit, source, descriptor: source, target, kind: "descriptor", algorithm: "analysis-boundary/1", review: "Synthetic one-file storage growth experiment only" });
  for (const row of table.entries) row.target = target;
  const encoded = encodeTransitionStore(table, history);
  const pack = JSON.parse(gunzipSync(encoded.bytes).toString()) as Array<[string, unknown]>;
  const after = new Set(pack.map(([hash]) => hash)), added = pack.filter(([hash]) => !store.pack.nodes.has(hash));
  const beforeBytes = readFileSync(resolve(root, folder + "executionNodes.json.gz")).length;
  return { schema: "execution-transition-storage-growth/1", experiment: "synthetic one-file descriptor edit plus full previous-target snapshot; no execution or calibration claim", source, file: path,
    beforeNodes: store.pack.nodes.size, afterNodes: after.size, newUniqueNodes: added.length,
    removedNodes: [...store.pack.nodes.keys()].filter(hash => !after.has(hash)).length,
    existingNodesUnchanged: pack.filter(([hash, node]) => store.pack.nodes.has(hash)).every(([hash, node]) => digest(node) === digest(store.pack.nodes.get(hash))),
    uniqueNodeBytesLF: Buffer.byteLength(JSON.stringify(added) + "\n"),
    packBytesBefore: beforeBytes, packBytesAfter: encoded.bytes.length, packDeltaBytes: encoded.bytes.length - beforeBytes,
    manifestDeltaBytesLF: Buffer.byteLength(encoded.manifestText) - Buffer.byteLength(lf(readFileSync(resolve(root, folder + "executionTransitions.json"), "utf8"))) };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const legacy = process.argv.find(arg => arg.startsWith("--prove-legacy="))?.slice("--prove-legacy=".length);
  if (legacy) {
    const original = (path: string) => execFileSync("git", ["show", `${legacy}:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    const text = lf(original(folder + "executionTransitions.json").toString()), archive = original("scripts/fixtures/execution-identity-history.json.gz");
    const table: TransitionTable = JSON.parse(text), history: History = JSON.parse(gunzipSync(archive).toString());
    const current = loadTransitions(root), restored = current.history();
    if (digest(table) !== current.pin.digest) throw Error("Migration must preserve the complete original table before adding a transition");
    for (const [commit, files] of Object.entries(history.trees)) {
      if (digest(files) !== digest(restored.trees[commit])) throw Error("Original snapshot inventory changed");
      for (const hash of Object.values(files)) if (restored.blobs[hash] !== history.blobs[hash]) throw Error("Original snapshot text changed");
    }
    const proof = { schema: "execution-transition-storage-migration/1", baseline: legacy, legacyTableDigest: digest(table),
      legacyTableBytesLF: Buffer.byteLength(text), legacyArchiveBytes: archive.length,
      rows: table.entries.map(({ target: _target, ...row }) => [row.commit, digest(row)]),
      descriptors: Object.keys(table.descriptors).sort(), snapshots: Object.entries(history.trees).sort().map(([commit, files]) => [commit, digest(files)]),
      referencedTextBlobs: Object.keys(restored.blobs).length };
    writeFileSync(resolve(root, "docs/reality/transition-storage-migration.json"), JSON.stringify(proof, null, 2) + "\n");
    console.info(JSON.stringify({ rows: proof.rows.length, descriptors: proof.descriptors.length, snapshots: proof.snapshots.length, legacyTableBytesLF: proof.legacyTableBytesLF, legacyArchiveBytes: proof.legacyArchiveBytes }));
  } else if (process.argv.includes("--migrate")) {
    const table: TransitionTable = JSON.parse(readFileSync(resolve(root, folder + "executionTransitions.json"), "utf8"));
    const history: History = JSON.parse(gunzipSync(readFileSync(resolve(root, "scripts/fixtures/execution-identity-history.json.gz"))).toString());
    const result = encodeTransitionStore(table, history);
    const read = (path: string) => path.endsWith("transitionPin.json") ? JSON.stringify(result.pin) : path.endsWith("executionTransitions.json") ? result.manifestText : result.bytes;
    const restored = loadTransitions(root, read);
    if (digest(restored.table) !== digest(table)) throw Error("Historical mappings changed during migration");
    const snapshots = restored.history();
    for (const [commit, files] of Object.entries(history.trees)) {
      if (digest(files) !== digest(snapshots.trees[commit])) throw Error(`Historical snapshot changed: ${commit}`);
      for (const hash of Object.values(files)) if (snapshots.blobs[hash] !== history.blobs[hash]) throw Error("Historical text changed during migration");
    }
    console.info(JSON.stringify({ rows: table.entries.length, descriptors: Object.keys(table.descriptors).length, snapshots: Object.keys(snapshots.trees).length, ...writeTransitionStore(root, table, history) }));
  } else if (process.argv.includes("--measure-delta")) {
    const result = measureTransitionDelta(root);
    writeFileSync(resolve(root, "docs/reality/transition-storage-delta.json"), JSON.stringify(result, null, 2) + "\n");
    console.info(JSON.stringify(result));
  } else if (process.argv.includes("--regenerate")) {
    const store = loadTransitions(root);
    console.info(JSON.stringify(writeTransitionStore(root, store.table, store.history())));
  } else throw Error("Expected --migrate or --regenerate");
}
