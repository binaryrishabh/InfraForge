import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { hash } from "./keyspace.fixture";

// LF-normalized SHA-256 captured on untouched c240891 before retained accounting. Never regenerate.
const pins = [
  [false, "4563650d387bec91741009e8fa75073a9ad41a39eba25e457ffe7167b2030ef8", "eb9aa86a763e44f8a2e7f7817eb1fdf5b29a0ea68955a3656e2a0a2590accebb", "2fdaf3866da45437241bb92ee777ca5c932244dd5066bfe8b678d8ddab4433c7", "55fc7c3d8854b3b78783a4072a2462037469897f94196d8c5174d21b40fc4e29"],
  [true, "4d954ab4452ee50060e8530ffa1ed9cb27f6ed26129c04799f73f080fe72131b", "c0fe964a8ff034fa314414c3fa128052d6bbccf72fb099c7f1c14cd71f3d3b92", "1609f24588408580ab94accf4f8eca3433c4e0f3893e7e6c8e91d6802cdd6142", "a866f653c4fe1534531ff463bca207c62981e778389739f0a7fb4eb242855890"],
] as const;
for (const [explicit, ...expected] of pins) test(`uncaptured accounting keeps historical bytes: explicit=${explicit}`, () => {
  const d = lbDesign();
  if (explicit) d.resources[0]!.lbSelection = { version: 1, policy: "round-robin" };
  const f = prepareLb(d); f.runtime.advanceTo(3000000);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
});
