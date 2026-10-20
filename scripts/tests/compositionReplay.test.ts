import { expect, test } from "bun:test";
import hashes from "../../docs/reality/stage1-composition-hashes.json";
import { compositionProofs } from "../reality/composition-proofs";
import { verifyCompositionHost } from "../reality/composition-host-proof";

test("pinned m2b–m2h fixture evidence retains pre-registry SHA-256 hashes", () => {
  expect(hashes).toEqual(compositionProofs());
});

test("independent extension reconstructs its original 88 source hashes after reviewed host bounds", () => {
  expect(verifyCompositionHost()).toBe(88);
});
