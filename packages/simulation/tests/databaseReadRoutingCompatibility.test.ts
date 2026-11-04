import { expect, test } from "bun:test";
import { databaseDesign, prepareDatabase } from "./databaseReplication.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched ec1130001b7739d5368955af71e0c71d16f5bcce. Never regenerate.
const pins = [
  ["plain", "209adf09c7212d405d33ec2810c0edbc70d844bdb69ab81fcce9caf6306ae3e2", "9290a4c753b82e14f3f5c41293fb546227c716a511e568cbc003b69bd8227ea8", "af6435388ba9874109992eedd2d24e2999570c9679528cf9fede08c3b5f3d7f2", "dedb1dbab2500d96a74f709d38f6e0f29749649eefcd104956079ad2854894c4"],
  ["primary", "40ab71af6bba5633fa65f2ac272af47af6e8a620be312961e77cc5c26f1b34da", "3bf8e878911d2c488f5607c0d251557bafd26f0a1c3ddb8e1fc61c2f3656fdce", "512d5bbd165d9761fddfee8df7d05e90b0a0bfdea37b90aa1baa9883692dc890", "b16748f6a3cb28d1baa2962e2c16747ca323c183d7574054085f688f2789bae5"],
  ["replica-preferred", "58d0f776dec6dc31ecf460fbe34264147e40b247feacbcc5508db2166a130f59", "a360d9d4e5f77d709777ea3af4d4b8236292963f7270621d7ab89730c16beebc", "81178cd7e6a77838aa6fc0f31cf9ef18b66135c04596c1c859a45a130a2a0dc2", "7923fc543dd9626dc56f7854d55df7ce4a45de7939afda2bdefac33f4a264aa4"],
] as const;
for (const [policy, ...expected] of pins) test(`regression: uncaptured read routing preserves ${policy} byte for byte`, () => {
  const design = databaseDesign();
  if (policy !== "plain") design.resources.at(-1)!.databaseReplication = { version: 1, enabled: true, replicationDelayMs: 2000, readPolicy: policy };
  const f = prepareDatabase(design); f.runtime.advanceTo(f.runtime.horizon);
  expect([f.contract, f.compiled, f.assumptions, f.runtime.evidence()].map(hash)).toEqual(expected);
});
