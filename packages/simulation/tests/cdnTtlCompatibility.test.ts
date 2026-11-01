import { expect, test } from "bun:test";
import { cdnSetup, cdnStackedSetup } from "./cdnTtl.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured on untouched a3abb6797e59d002562a36573bfdeb26f6fbdd3b. Never regenerate.
const pins = [
  [
    "storage",
    "467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454",
    "6b6fccf43aaf59e860884dad4a1539ab3be78dfbbbbcf5c172fd4e286cc04d3d",
    "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf",
    "6012cec19bf8b6640d72c4857b2f11fde3b18b0ac693c9563a908fb55a348f92"
  ],
  [
    "repeated",
    "467009837f1af833c39a3986635742206a595c218d54d4921ea7b37fd0435454",
    "ff8405d74875eb8b48a3c901b5f18ce8c17a5006d75b44bded4bdc32dbcd3089",
    "602a492a3379d76595bc1e52bdfcd8c377a96a67646ecc61190bb894cf7479bf",
    "1e8be45dede42f6f7d9d2a3b8b4eb2e3d5104a3c5877aea78e12e21f97d55263"
  ],
  [
    "dns",
    "b263c2bce8d87d313c1adb098bdb7298835e210032e3c9c5be0900929a3cde01",
    "2638557b805539543ddc0b46943e440fb32dcb9a75091e3cb9660a08571727dc",
    "411ba217aa4128dad507c614d431b68edaa4224ac10c8e5aeea6fa5cb10ea993",
    "4b5ea7812a02597946535cdaae922ca4ca2ca81544aa245c2e16be2a08c9c285"
  ],
  [
    "monitoring",
    "fcfae4b085c3b20368826edac7cdd0edbae8f63077eacd4e05ea8430ef04e6c6",
    "f56f6226ddd4e6e80f77323cbdb2f01b90907f7291cace0f6a045d0ae598ed6d",
    "55565ec9fd0bc36edba3c31fe7492c848144391b50a1583ed9f0189977ea68e7",
    "aceac4194e1c326b4f0eb0ae31fa2914a5321c4b153555f9fd80c420cb61d384"
  ],
  [
    "stacked",
    "2707d75901efae7053cd5a2e058b4a2764cdaa600e7666ac906062d7528e8842",
    "9023301c620c07b750b4735157da364b4f8fb3b28ca8af0e8f3497cb11c4b5af",
    "f61c78d86e528b198403394fd8eb54dc8340f4bc08a4f7c9f284695a82732a1c",
    "104d8b6b15f0d4809d4e4d01d37f9445bf54f4c915e38223f2364e0415bfcbc3"
  ]
] as const;
for (const [mode, ...expected] of pins) test(`CDN Depth 1 historical contract, compiled artifact, assumptions and evidence: ${mode}`, () => {
  const f = mode === "stacked" ? cdnStackedSetup() : cdnSetup(mode);
  f.runtime.advanceTo(mode === "stacked" ? 250000 : 12_000_000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
