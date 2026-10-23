import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { historicalSlice, readHistoricalSlices, validateHistoricalSlices } from "../historical-slice-reviews";
import { sourceHash } from "../../apps/backend/executionIdentity/hash";
import { verifyCapabilityImports } from "../../apps/backend/executionIdentity/capabilities";
import { verifyModuleLoading } from "../../apps/backend/executionIdentity/loading";

const root = resolve(import.meta.dir, "../..");
test("all historical slice receipts bind their original source and acceptance bytes without Git or live source", () => {
  const { snapshot, receipts } = readHistoricalSlices();
  const base = mkdtempSync(resolve(tmpdir(), "infraforge-slices-"));
  try {
    mkdirSync(resolve(base, "docs/reality"), { recursive: true });
    for (const path of [...Object.keys(receipts), "docs/reality/frozen-artifacts.json", "docs/reality/historical-slice-snapshots.json.gz"]) copyFileSync(resolve(root, path), resolve(base, path));
    expect(Object.keys(readHistoricalSlices(base).receipts)).toEqual(Object.keys(receipts));
    for (const [path, entry] of Object.entries(snapshot.receipts)) {
      const slice = historicalSlice(path, base);
      for (const [file, hash] of Object.entries(entry.files)) expect(sourceHash(slice.read(file))).toBe(hash);
    }
    const path = "scripts/tests/execution-identity.test.ts";
    mkdirSync(resolve(base, "scripts/tests"), { recursive: true });
    writeFileSync(resolve(base, path), "later acceptance edits");
    expect(historicalSlice("docs/reality/first-stack-source-review.json", base).read(path)).not.toBe("later acceptance edits");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("historical slices reject receipt, source, snapshot, generator and inventory tampering", () => {
  const { snapshot, receipts } = readHistoricalSlices(), path = Object.keys(receipts)[0]!;
  expect(() => validateHistoricalSlices(snapshot, { ...receipts, [path]: receipts[path] + " " })).toThrow("receipt changed");
  const missing = { ...receipts }; delete missing[path];
  expect(() => validateHistoricalSlices(snapshot, missing)).toThrow("inventory changed");
  for (const mutate of [
    (copy: typeof snapshot) => { copy.blobs[Object.keys(copy.blobs)[0]!] += " altered"; },
    (copy: typeof snapshot) => { delete copy.blobs[Object.keys(copy.blobs)[0]!]; },
    (copy: typeof snapshot) => { delete copy.receipts[path]!.files[Object.keys(copy.receipts[path]!.files)[0]!]; },
    (copy: typeof snapshot) => { delete copy.generators[Object.keys(copy.generators)[0]!]; },
  ]) {
    const copy = structuredClone(snapshot); mutate(copy);
    expect(() => validateHistoricalSlices(copy, receipts)).toThrow();
  }
  expect(() => historicalSlice("docs/reality/not-reviewed.json")).toThrow("Unknown historical slice");
});

test("historical acceptance does not grant current exact-source loading or import permissions", () => {
  const slice = historicalSlice("docs/reality/account-essentials-source-review.json");
  expect(slice.read("apps/backend/auth/email.ts")).toContain("fetch");
  const path = "apps/backend/utils/config.ts", source = readFileSync(resolve(root, path), "utf8");
  const altered = source + "\n// later edit requires an exact capability review\n";
  expect(() => verifyModuleLoading(altered, path)).toThrow("Unreviewed");
  expect(() => verifyCapabilityImports({ paths: [path], read: file => file === path ? altered : readFileSync(resolve(root, file), "utf8") }, new Set([path]), [])).toThrow("Unreviewed execution capability import");
});
