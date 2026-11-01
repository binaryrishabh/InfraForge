import { expect, test } from "bun:test";
import { firewallSetup } from "./firewallCapacity.fixture";
import { hash } from "./asyncCanvas.fixture";

// LF-normalized SHA-256 captured before production edits on a2700db14fadb008df4ea495b25368ca0eac740e. Never regenerate.
const pins = [
  ["front", "a90237f406dd92d3bc5083d346e952c42fb60836d5f210fbaf0d1cd725d94e38", "06d7e401fa280159e0310a53af2ca9b0f00f0003796cc85715bc84cecd6ea887", "18f5710f29ec7a6a4e8049537ae5d067b2e67f1e5868a998823e77c2f227b506", "43ccfe7eddb95d8b9b5a055318d2ef3d7419b4c98f6db2cb1c6b44053b0a07ea"],
  ["update", "a90237f406dd92d3bc5083d346e952c42fb60836d5f210fbaf0d1cd725d94e38", "46704845a06a0f56630d3370a54bc0885f765d44ed9134193a63813a3b9da093", "18f5710f29ec7a6a4e8049537ae5d067b2e67f1e5868a998823e77c2f227b506", "6d1a0c4b0f1210d0ce5cacc47583fc8f5feed68a6c42a386923ce0904fbbe892"],
  ["tls", "a90237f406dd92d3bc5083d346e952c42fb60836d5f210fbaf0d1cd725d94e38", "fbf43591ff7685b32ab436e434277589f3c18c846b4bccf31ade25e59d4a6e34", "18f5710f29ec7a6a4e8049537ae5d067b2e67f1e5868a998823e77c2f227b506", "43067e909cf5aa35f4bddd52bc20cc383a32c17b31d10e2b5c44c14aba878cbe"],
  ["reuse", "a90237f406dd92d3bc5083d346e952c42fb60836d5f210fbaf0d1cd725d94e38", "f13899067b7adfd63cc51197170b5d818eda7d2035a0c2a92da7228d1c65c522", "18f5710f29ec7a6a4e8049537ae5d067b2e67f1e5868a998823e77c2f227b506", "3a1930978d0397d51cd259066af0067d8a3c04c98c92858fad2eb9e730f3ad25"],
  ["two", "4f5447b2dac4e9f31b3a313974877ec666fc15f733273cce996d15a42f24d5a6", "78741455dbb22e8ba1fecec4ee7675667e4540fc921e95f3c94e84cc7c9a6de8", "25f9cbd0ce589b160f4670bb8fb734d4d45f56711ce371bd8942b71e9123fede", "a921078ed1ca4d4be6f806965fea9da65d4147bea5edfb1dc81c53e4ffcce5af"],
] as const;
for (const [mode, ...expected] of pins) test(`firewall capacity preserves historical contract, artifact, assumptions and evidence: ${mode}`, () => {
  const f = firewallSetup(mode); f.runtime.advanceTo(f.runtime.horizon);
  expect([hash(f.contract), hash(f.compiled), hash(f.assumptions), hash(f.runtime.evidence())]).toEqual(expected);
  expect(f.compiled.input.systems.firewalls.every(f => f.maxFlows.kind === "known" && f.maxFlows.value === 10000)).toBe(true);
});
