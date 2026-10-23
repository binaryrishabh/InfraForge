import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { decodeFrozenArtifact, decodedLimit, compressedLimit, frozenArtifactPins, readArtifactText, writeProofText } from "../reality/frozen-artifacts";

const root = resolve(import.meta.dir, "../.."), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const text = Buffer.from('{"evidence":"preserved"}\n'), bytes = gzipSync(text);
const pin = { bytes: text.length, sha256: hash(text), gzipBytes: bytes.length, gzipSha256: hash(bytes) };
test("every frozen artifact retains its independently pinned decoded bytes and valid JSON", () => {
  for (const [path, pin] of Object.entries(frozenArtifactPins())) {
    const decoded = readArtifactText(root, path);
    expect(hash(Buffer.from(decoded))).toBe(pin.sha256);
    expect(Buffer.byteLength(decoded)).toBe(pin.bytes);
    expect(() => JSON.parse(decoded)).not.toThrow();
  }
});
test("frozen reader rejects damaged gzip, incorrect decoded hashes, truncation and expansion bombs", () => {
  expect(decodeFrozenArtifact(bytes, pin)).toBe(text.toString());
  const damaged = Buffer.from(bytes); damaged[damaged.length - 5]! ^= 1;
  expect(() => decodeFrozenArtifact(damaged, pin)).toThrow("compressed digest");
  // Even if the compressed digest were repinned, gzip's integrity check remains.
  expect(() => decodeFrozenArtifact(damaged, { ...pin, gzipSha256: hash(damaged) })).toThrow();
  expect(() => decodeFrozenArtifact(bytes.subarray(0, -1), pin)).toThrow("length");
  expect(() => decodeFrozenArtifact(bytes, { ...pin, sha256: "0".repeat(64) })).toThrow("decoded digest");
  expect(() => decodeFrozenArtifact(bytes, { ...pin, bytes: text.length - 1 })).toThrow();
  expect(() => decodeFrozenArtifact(bytes, { ...pin, bytes: decodedLimit + 1 })).toThrow("size limit");
  expect(() => decodeFrozenArtifact(bytes, { ...pin, gzipBytes: compressedLimit + 1 })).toThrow("size limit");
  const invalid = Buffer.from("not JSON"), gzip = gzipSync(invalid);
  expect(() => decodeFrozenArtifact(gzip, { bytes: invalid.length, sha256: hash(invalid), gzipBytes: gzip.length, gzipSha256: hash(gzip) })).toThrow();
});
test("frozen evidence fails closed on missing archives, ambiguous copies and a changed manifest", () => {
  const base = mkdtempSync(resolve(tmpdir(), "infraforge-frozen-"));
  try {
    mkdirSync(resolve(base, "docs/reality"), { recursive: true });
    const manifest = "docs/reality/frozen-artifacts.json", path = "docs/reality/m2h-proofs.json";
    copyFileSync(resolve(root, manifest), resolve(base, manifest));
    expect(() => readArtifactText(base, path)).toThrow();
    writeFileSync(resolve(base, path), "{}");
    expect(() => readArtifactText(base, path)).toThrow("ambiguous");
    const changed = JSON.parse(readFileSync(resolve(base, manifest), "utf8")); delete changed.files[path];
    writeFileSync(resolve(base, manifest), JSON.stringify(changed));
    expect(() => readArtifactText(base, path)).toThrow("manifest changed");
    expect(() => writeProofText(resolve(root, path), "{}\n")).toThrow("Cannot overwrite frozen evidence");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
