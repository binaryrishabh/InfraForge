import { expect, test } from "bun:test";
import { databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched 69086aea7ecc3eecb4931e8463ae2712751cf73f. Never regenerate.
const pins = [
  [
    "plain",
    "209adf09c7212d405d33ec2810c0edbc70d844bdb69ab81fcce9caf6306ae3e2",
    "9290a4c753b82e14f3f5c41293fb546227c716a511e568cbc003b69bd8227ea8",
    "af6435388ba9874109992eedd2d24e2999570c9679528cf9fede08c3b5f3d7f2",
    "dedb1dbab2500d96a74f709d38f6e0f29749649eefcd104956079ad2854894c4"
  ],
  [
    "cache",
    "fca52c26332a00e5d799d946e7aca3efe27b887cbbf48784906762326fa78ed9",
    "f10e34e1a95f1198dd262ce21310ffe4e392fb6f2e05ad3ab11c2416aa0b5e9c",
    "0c5a11ffdb368345515031299f2b9624d5226b18c2e0cb8331b6c198231d9498",
    "689f336e2b5423e696e855bf025305b46bff2dd302b3804d3c00e440566e622a"
  ],
  [
    "hot-key",
    "33b0428892770a18d699b9d3855e3a6834ef54d3abfc84d8fb0722818cb12874",
    "d0852bac675755c656841b8cb246fc8782cc3aaeb85f1a06cce5beac543b1233",
    "945ece30a047b261f87e62685029417051802b43afc28923b418604289b899b8",
    "1f42c577824056ea277a98a3d9e007bc141fa6c03565453115f6673304ba54ae"
  ],
  [
    "lb-vm",
    "876ab144bf5dc6a9c84239058a940363dedbbd73b5c36687501ffdb7afccc69b",
    "c6e5436bcc290c75851ce33f8b64c0565f0ff50603bf1620baf5a39de370d4c2",
    "928c4deac001692bfaf7e395e6239b5e302b93dc6ba258bb04ee2e93d24985e8",
    "420b9412f02084966f38233d72fea3587758b42bf2abb7c9bff10555844b33eb"
  ]
] as const;
for (const [mode, ...expected] of pins) test(`database without HA preserves contract, artifact, assumptions and evidence: ${mode}`, () => {
  const f = prepareDatabase(databaseDesign(mode)); f.runtime.advanceTo(f.runtime.horizon);
  expect([f.contract, f.compiled, f.assumptions, f.runtime.evidence()].map(hash)).toEqual(expected);
});
