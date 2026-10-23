import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { digest, sourceHash } from "../apps/backend/executionIdentity/hash";
import { readArtifactText } from "./reality/frozen-artifacts";

const root = resolve(import.meta.dir, "..");
export interface SliceSnapshot {
  schema: string;
  receipts: Record<string, { digest: string; files: Record<string, string> }>;
  generators: Record<string, string>;
  blobs: Record<string, string>;
}
interface Pin { path: string; hash?: string; sha256?: string; currentHash?: string; original?: string | null; originalText?: string; originalHash?: string | null }
export interface SliceReview { schema: string; baseline?: string; files: Pin[]; acceptance?: Pin[] }

export function validateHistoricalSlices(snapshot: SliceSnapshot, receipts: Record<string, string>) {
  if (snapshot.schema !== "historical-slice-snapshots/1" || digest(Object.keys(receipts).sort()) !== digest(Object.keys(snapshot.receipts).sort())) throw Error("Historical receipt inventory changed");
  const referenced = new Set(Object.values(snapshot.generators));
  for (const [hash, text] of Object.entries(snapshot.blobs)) if (sourceHash(text) !== hash) throw Error("Historical slice blob changed");
  for (const [path, entry] of Object.entries(snapshot.receipts)) {
    if (sourceHash(receipts[path]!) !== entry.digest) throw Error(`Historical receipt changed: ${path}`);
    const review = JSON.parse(receipts[path]!) as SliceReview;
    const files: Record<string, string> = {};
    for (const row of [...review.files, ...review.acceptance ?? []]) {
      const hash = row.hash ?? row.sha256 ?? row.currentHash;
      if (!hash || !Object.hasOwn(snapshot.blobs, hash) || files[row.path]) throw Error(`Missing or duplicate historical slice source: ${row.path}`);
      files[row.path] = hash; referenced.add(hash);
      const original = row.original ?? row.originalText;
      if (original !== undefined && sourceHash(original) !== row.originalHash) throw Error(`Historical projection changed: ${row.path}`);
    }
    if (digest(files) !== digest(entry.files)) throw Error(`Historical slice snapshot changed: ${path}`);
  }
  if (digest([...referenced].sort()) !== digest(Object.keys(snapshot.blobs).sort())) throw Error("Historical slice blob coverage changed");
}

export function readHistoricalSlices(base = root) {
  const snapshot = JSON.parse(readArtifactText(base, "docs/reality/historical-slice-snapshots.json")) as SliceSnapshot;
  const receipts = Object.fromEntries(readdirSync(resolve(base, "docs/reality")).filter(path => path.endsWith("source-review.json")).map(name => {
    const path = `docs/reality/${name}`;
    return [path, readFileSync(resolve(base, path), "utf8")];
  }));
  validateHistoricalSlices(snapshot, receipts);
  return { snapshot, receipts };
}

export function historicalSlice(path: string, base = root) {
  const { snapshot, receipts } = readHistoricalSlices(base), entry = snapshot.receipts[path];
  if (!entry) throw Error(`Unknown historical slice: ${path}`);
  return { review: JSON.parse(receipts[path]!) as SliceReview, read: (file: string) => {
    const hash = entry.files[file], text = hash ? snapshot.blobs[hash] : undefined;
    if (text === undefined || !hash || sourceHash(text) !== hash) throw Error(`Unknown historical slice source: ${file}`);
    return text;
  } };
}

export function checkHistoricalSlice(path: string) {
  if (process.argv.includes("--write")) throw Error("This slice review is immutable. Review current capabilities explicitly, run current tests, then refresh-execution.ts; do not repin historical receipts.");
  const { review } = historicalSlice(path);
  return { schema: review.schema, historicalFiles: review.files.length, historicalAcceptance: review.acceptance?.length ?? 0 };
}

if (import.meta.main) {
  const { snapshot } = readHistoricalSlices();
  console.info(JSON.stringify({ historicalSlices: Object.keys(snapshot.receipts).length, verifiedBlobs: Object.keys(snapshot.blobs).length }));
}
