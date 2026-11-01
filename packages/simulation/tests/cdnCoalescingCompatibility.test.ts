import { expect, test } from "bun:test";
import { coalescingBaseline } from "./cdnCoalescingBaseline.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched c9e4dd99ca75bf42cceb5e9b1b5b2535aa336d8b. Never regenerate.
const pins = [
  ["storage", "467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454", "6b6fccf43aaf59e860884dad4a1539ab3be78dfbbbbcf5c172fd4e286cc04d3d", "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "6012cec19bf8b6640d72c4857b2f11fde3b18b0ac693c9563a908fb55a348f92"],
  ["repeated", "467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454", "ff8405d74875eb8b48a3c901b5f18ce8c17a5006d75b44bded4bdc32dbcd3089", "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "1e8be45dede42f6f7d9d2a3b8b4eb2e3d5104a3c5877aea78e12e21f97d55263"],
  ["dns", "b263c2bce8d87d313c1adb098bdb7298835e210032e3c9c5be0900929a3cde01", "2638557b805539543ddc0b46943e440fb32dcb9a75091e3cb9660a08571727dc", "411ba217aa4128dad507c614d431b68edaa4224ac10c8e5aeea6fa5cb10ea993", "4b5ea7812a02597946535cdaae922ca4ca2ca81544aa245c2e16be2a08c9c285"],
  ["explicit-ttl", "3c26d20e01b32539cca60aabadff36d848178eef7f9b298d1322566be2847713", "21ad963163693c283b56c80cfb7e4cddd40d544ea5b2c07b93217439d8e25163", "95321ec8a4ba816daf80f110ccc6a75529d4394fcfd732f28ca3f6aed573e09b", "6b51cc7180ed77b639bbd8f534e89107726a9be5707c57fd0ac891941394a92d"],
  ["concurrent-misses", "a2ac59da79ea650183bc5fb55192882ae3af0bbf206e4c9329f90366df0d23bc", "f2bedc8f46c3489d2f8a2b87a7208e68b8aeb4d219f75aed3893fe3c61d876da", "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf", "b0cad9dc8bfbe6241fe1d50abdb5586f2c877a7b4632e9eb91629736a021240a"],
] as const;
for (const [mode, ...expected] of pins) test(`CDN Depth 2 preserves base contract, compiled input, assumptions and evidence: ${mode}`, () => {
  const f = coalescingBaseline(mode); f.runtime.advanceTo(mode === "concurrent-misses" ? 1000000 : 12000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
  expect(f.compiled.input.resources.find(r => r.kind === "cdn")).toMatchObject({ coalesce: true, maxWaiters: { value: 256 } });
  if (mode === "concurrent-misses") expect(f.runtime.evidence().systems.cdns[0]!).toMatchObject({ coalesced: 15, originRequests: 1, fills: 1 });
});
