import { expect, test } from "bun:test";
import hashes from "../../../docs/reality/stage1-composition-hashes.json";
import { compositionProofs } from "../../../scripts/reality/composition-proofs";

test("pinned m2b–m2h fixture evidence retains pre-registry SHA-256 hashes", () => {
  expect(hashes).toEqual(compositionProofs());
});
