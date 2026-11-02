import { expect, test } from "bun:test";
import { keyspaceDesign, prepareKeyspace, hash } from "./keyspace.fixture";

test("captured client-retry/1 without timeout preserves literal base bytes", () => {
  const design = keyspaceDesign();
  design.workload.clientRetry = { version: 1, maxAttempts: 3, backoffMs: 50 };
  const f = prepareKeyspace(design); f.runtime.advanceTo(3_000_000);
  // LF-normalized SHA-256 captured on untouched 2a3316816f20ab76231f2b77b6743dd0f9983561. Never regenerate.
  expect([f.contract, f.compiled, f.assumptions, f.runtime.evidence()].map(hash)).toEqual([
    "63d5715c865d356b1ebca1dfc3549f5d33add8a6511c2c17eb49ab63db8904b8",
    "ab36febc8283346eec07ecd1ae72bc0e3355e6952df4bab31b99868213f43500",
    "c1ebca0b5450933856efedb0e7e56e3ded5341c3ed38dc391f80f664c7415a91",
    "8303b836a4c6a7a1fc877bfc6b15d3eadc95196c6447594710f8eb89752a7164",
  ]);
});
