import { expect, test } from "bun:test";
import { firewallSetup } from "./firewallCapacity.fixture";
import { hash } from "./asyncCanvas.fixture";
// LF-normalized SHA-256 captured on the untouched slice base before production edits. Never regenerate.
const pins = [
  [
    "front",
    "ec63f3819b56b3a212a4f18b9a7dc86345d36a0f21d0b4060ad06ead02c68bdd",
    "424211e1650071cd78587fb8716ccf4a8b52ea2a8b796a7462dd0c95926fe07c",
    "a6356e074c2360234ed6bd0389fff57538905ca5c02d8e3bee67c5131de5ccd7",
    "326c982fcc0bd6a80bd898b9d0c25f3298406187a24ebf55309fe70c887da6b8"
  ],
  [
    "update",
    "ec63f3819b56b3a212a4f18b9a7dc86345d36a0f21d0b4060ad06ead02c68bdd",
    "b89adddeec81e1d1fc177dbb188f0c42499a6c2343d3c21c6757256bd2a42324",
    "a6356e074c2360234ed6bd0389fff57538905ca5c02d8e3bee67c5131de5ccd7",
    "593271be96aa1858b30f65931999381ba526418afc4a3fd60d6551c201a97628"
  ],
  [
    "reuse",
    "ec63f3819b56b3a212a4f18b9a7dc86345d36a0f21d0b4060ad06ead02c68bdd",
    "e13d7159e3e19aa366cedb09b62b4c97d1474a0a4f6fc4a10353e701774d3120",
    "a6356e074c2360234ed6bd0389fff57538905ca5c02d8e3bee67c5131de5ccd7",
    "e06a5a56a9af6160ff7682fa0a4992b8876b36ffe41af5e529aeefaddb6f4a50"
  ],
  [
    "two",
    "5c392a4a05b938200d48f00a945c2d880c5cb7b52bd5652551a46ec995982902",
    "2d42d74c8377848f2096c04cffd4527a4312f48ed2fb5a298d5906a80d56c0e9",
    "92612a211306e401f74361586d34b012d087dc91d557d5592fab7712e109fe16",
    "947b9a60d3f83afed1988da79f4ccf2c48d2e1e89e1ed114882fd8b61cc5f079"
  ],
  [
    "tls",
    "ec63f3819b56b3a212a4f18b9a7dc86345d36a0f21d0b4060ad06ead02c68bdd",
    "1bd387666150d040b5037f5aa39362f486fd71d90298a4855037d67f0f9f9e4c",
    "a6356e074c2360234ed6bd0389fff57538905ca5c02d8e3bee67c5131de5ccd7",
    "3634d86101d795ba22a819834b87d332860eca8c786e3461de91b7bf8f31220e"
  ]
] as const;
for (const [mode, ...expected] of pins) test(`regression: historical capacity capture retains semantics: ${mode}`, () => {
 const f = firewallSetup(mode, 1); f.runtime.advanceTo(f.runtime.horizon);
 expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
