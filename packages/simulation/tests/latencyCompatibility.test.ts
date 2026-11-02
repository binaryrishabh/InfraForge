import { expect, test } from "bun:test";
import { keyspaceDesign, hash } from "./keyspace.fixture";
import { contractFromDesign, compileProduct, createProductModel2 } from "../src/internalProduct";
import { createModel2Run } from "../src/model2Run";

test("unmarked contract, artifact, assumptions, evidence and live views retain pre-batch bytes", () => {
  const d = keyspaceDesign(), b = contractFromDesign(d, { adapterProfiles: [] }); if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(d, b.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const r = createProductModel2(c.value); r.advanceTo(3000000);
  const live = createModel2Run({ resources: d.resources, connectionLines: d.connections, workloadProfile: d.workload, seed: "latency-history", adapterProfiles: [] }, 3);
  const views = [live.view()]; for (let n = 0; n < 3; n++) { live.advance(); views.push(live.view()); }
  // LF-normalized SHA-256 captured on untouched a654302 before this batch. Never regenerate.
  expect([b.contract, c.value, b.assumptions, r.evidence(), views].map(hash)).toEqual([
    "9b4497a065db89fe32fcb0ac532a705e31168013945fbacce4869eb00dcb570e",
    "b7136b8b27952fe01a6d7a17363b3a866dc2e42288b660cf1266b201f2d2893e",
    "32a0ab4f9112db79346711eefe2f9c3202756b156769901fddf26be4c0801521",
    "a3533eb363a535ddce3ee402af498683e3b032c9f42f53f7ef039216b80c5714",
    "98488f983097c69c5e72ebbc2f5b40c92601592ed517c032579423e06aa09208",
  ]);
});
