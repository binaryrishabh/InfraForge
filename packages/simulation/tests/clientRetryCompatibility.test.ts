import { expect, test } from "bun:test";
import { keyspaceDesign, prepareKeyspace, hash } from "./keyspace.fixture";

test("historical workload without client retries preserves literal base bytes", () => {
  const { contract, assumptions, compiled, runtime } = prepareKeyspace(keyspaceDesign());
  runtime.advanceTo(3_000_000);
  const actual = [contract, compiled, assumptions, runtime.evidence()].map(hash);
  // LF-normalized SHA-256 captured on untouched 7651c5c1659523d464a5d410366ee78aaafa88a1. Never regenerate.
  expect(actual).toEqual([
    "9b4497a065db89fe32fcb0ac532a705e31168013945fbacce4869eb00dcb570e",
    "b7136b8b27952fe01a6d7a17363b3a866dc2e42288b660cf1266b201f2d2893e",
    "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521",
    "a3533eb363a535ddce3ee402af498683e3b032c9f42f53f7ef039216b80c5714",
  ]);
});
