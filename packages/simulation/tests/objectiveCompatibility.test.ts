import { expect, test } from "bun:test";
import { latencyDesign } from "./latency.fixture";
import { hash } from "./keyspace.fixture";
import { contractFromDesign, compileProduct, createProductModel2, currentAdapterProfiles } from "../src/internalProduct";

test("objective omission preserves contract, compiled input, assumptions and evidence bytes", () => {
  const d = latencyDesign(true, true);
  const b = contractFromDesign(d, { adapterProfiles: [...currentAdapterProfiles(d.resources, d.workload), "traffic-evidence/2"] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(d, b.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const r = createProductModel2(c.value); r.advanceTo(3000000);
  // LF-normalized SHA-256 captured on untouched 311487b before this batch. Never regenerate.
  expect([b.contract, c.value, b.assumptions, r.evidence()].map(hash)).toEqual([
    "66e3f98bb055024edaf6b6253a53c5d22017282a8b9c83033d73d4db4b3b4368",
    "8708764adbca7dee4b32eaffa77e6cd3c3266386f43dfb7ea0990b217702cea9",
    "c3756affb8ef9c159d1a91cb362a982cba2665cd721920255e6b88426d3908d7",
    "dd27921f640704c6d242a948f92cba142dc2ae7b3a82af0f21443c591d53d3bc",
  ]);
});
