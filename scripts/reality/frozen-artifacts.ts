import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { digest, lf } from "../../apps/backend/executionIdentity/hash";

export interface FrozenArtifactPin { bytes: number; sha256: string; gzipBytes: number; gzipSha256: string }
export const decodedLimit = 32 * 1024 * 1024;
export const compressedLimit = 16 * 1024 * 1024;
const root = resolve(import.meta.dir, "../..");
const manifestDigest = "d4d6cb4bec38ab7be2c07b3478292c0e4173124d52158da458c25da29c564a75";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function frozenArtifactPins(base = root): Record<string, FrozenArtifactPin> {
  const manifest = JSON.parse(readFileSync(resolve(base, "docs/reality/frozen-artifacts.json"), "utf8"));
  if (digest(manifest) !== manifestDigest || manifest.schema !== "frozen-artifacts/1") throw Error("Frozen artifact manifest changed");
  return manifest.files;
}

// The only gzip proof reader. Authenticate both storage bytes and decoded bytes;
// enforce bounds before allocating the decoded buffer, not after JSON parsing.
export function decodeFrozenArtifact(bytes: Buffer, pin: FrozenArtifactPin): string {
  if (!Number.isSafeInteger(pin.bytes) || pin.bytes <= 0 || pin.bytes > decodedLimit ||
      !Number.isSafeInteger(pin.gzipBytes) || pin.gzipBytes <= 0 || pin.gzipBytes > compressedLimit ||
      bytes.length > compressedLimit || bytes.length !== pin.gzipBytes) throw Error("Frozen artifact size limit or length mismatch");
  if (hash(bytes) !== pin.gzipSha256) throw Error("Frozen artifact compressed digest changed");
  const decoded = gunzipSync(bytes, { maxOutputLength: pin.bytes });
  if (decoded.length !== pin.bytes || hash(decoded) !== pin.sha256) throw Error("Frozen artifact decoded digest changed");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  JSON.parse(text); // Valid JSON is part of the archive contract.
  return text;
}

export function readArtifactText(base: string, path: string): string {
  const pin = frozenArtifactPins(base)[path];
  if (!pin) return readFileSync(resolve(base, path), "utf8");
  if (existsSync(resolve(base, path))) throw Error(`Frozen artifact has an ambiguous plain copy: ${path}`);
  const archive = resolve(base, path + ".gz");
  if (statSync(archive).size > compressedLimit) throw Error("Frozen artifact compressed size limit");
  return decodeFrozenArtifact(readFileSync(archive), pin);
}

export function readProofText(file: string | URL): string {
  const absolute = resolve(file instanceof URL ? fileURLToPath(file) : file);
  return readArtifactText(root, relative(root, absolute).replaceAll("\\", "/"));
}

// Existing proof generators may reproduce an immutable proof, never replace it
// with current-engine evidence. New measurements need a separately named file.
export function writeProofText(file: string | URL, text: string) {
  const absolute = resolve(file instanceof URL ? fileURLToPath(file) : file);
  const path = relative(root, absolute).replaceAll("\\", "/");
  if (frozenArtifactPins()[path]) {
    if (lf(readArtifactText(root, path)) !== lf(text)) throw Error(`Cannot overwrite frozen evidence: ${path}`);
  } else writeFileSync(absolute, text);
}
