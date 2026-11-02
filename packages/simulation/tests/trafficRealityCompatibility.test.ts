import { expect, test } from "bun:test";
import { RESOURCE_PORTS } from "@infraforge/domain/resource";
import { keyspaceDesign, hash } from "./keyspace.fixture";
import { canvasFlow } from "./applicationFlow.fixture";
import { contractFromDesign } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

// LF-normalized SHA-256 captured on untouched b8ddbd7d26675c00e54a5b99240c14c62623f237. Never regenerate.
const pins = [
  ["steady", "05c0546056fed1b953d95cf119d1b8ab2b8a8598d5ed8d6c128f7640649baf73", "9b29fc322bbd67a4a769b0bcf6e32b230e22284f2220c5846f8681a8a3a1dbaa", "4c708f8334d80c26e161a2fdb62807f99191f299361d3b334ebbd87db2b70306", "a5667c487cf0cdc22a40a91b56d6385b561a39b3f5bb7f0dd50e742aced8d8eb"],
  ["repeating-peak", "2f481e0bcd04fe9264ea2adcb5aade215972f5bb909102fb04e8022561f72643", "3458e74d2d7033f1180d9e70c5c6ca7ac5d28c0274869d79b65266df608dc66d", "d6f4e1ef2d281515d1b50c9cd083bf01950203ba148af18d02fbad164091cafe", "f43e5ab9b69b0091f5556bced39211d33bab61243f8b2986ce67b45d43f372bd"],
  ["live-load", "3b1b21c3373b8f47e0d9c80416406ef130a3c0d8857911924f73fc75196bf21b", "85afc0c7fa0c33761dd769609bd8b8e612b9d28c5fbfbbe85a49dbc9d9c21bdc", "4c708f8334d80c26e161a2fdb62807f99191f299361d3b334ebbd87db2b70306", "b225262ea26cd92d505e4173534c6f274b0c4a3a66d54a5c1b4c824400aa3194"],
  ["application-flow", "788ce6df42ea71e15f0059080d05a2e9d7035f0f7c1125106b3b0a506f183dab", "60be0f537b3c4c4ea54988887fd56288091066c49cde07010158687b135117e5", "69cf09ad57167c6c5a4fc4ec3ef40f93be49e4fc9da00ca2d62a5cbae65b5980", "713ba4784eaaf35afc34e001fb724a467522d11ef78be763abc4535253916fbf"],
] as const;
for (const mode of ["steady", "repeating-peak", "live-load", "application-flow"]) test(`historical traffic contract, artifact, assumptions and evidence: ${mode}`, () => {
  const d = mode === "application-flow" ? canvasFlow() : keyspaceDesign();
  if (mode !== "application-flow") {
    d.resources = d.resources.filter(r => r.id !== "cache");
    d.resources.unshift({ id: "lb", type: "Load Balancer", x: 0, y: 0 });
    d.connections = [["lb", "app"], ["app", "db"]].map(([s, t], i) => ({ id: `edge-${i}`, sourceId: s!, targetId: t!, sourceType: d.resources.find(r => r.id === s)!.type, targetType: d.resources.find(r => r.id === t)!.type, port: RESOURCE_PORTS[d.resources.find(r => r.id === t)!.type] }));
  }
  if (mode === "repeating-peak") Object.assign(d.workload, { trafficShape: "peak", peakMultiplier: 3 });
  const built = contractFromDesign(d); if ("refused" in built) throw Error(JSON.stringify(built));
  const { q, ledger } = quantities();
  if (mode === "repeating-peak") built.contract.arrival.peak = { start: q("traffic.peak.start", 500000, "us"), end: q("traffic.peak.end", 1000000, "us"), every: q("traffic.peak.every", 1500000, "us") };
  if (mode === "live-load") Object.assign(built.contract.arrival, { generated: true, changes: [
    { at: q("traffic.change.1", 1000000, "us"), fraction: q("traffic.fraction.1", 0.5, "ratio") },
    { at: q("traffic.change.2", 2000000, "us"), fraction: q("traffic.fraction.2", 0, "ratio") },
    { at: q("traffic.change.3", 2500000, "us"), fraction: q("traffic.fraction.3", 1, "ratio") },
  ] });
  built.contract.ledger.push(...ledger);
  const c = compileProduct(d, built.contract); if (!c.ok) throw Error(JSON.stringify(c));
  const runtime = createProductModel2(c.value); runtime.advanceTo(3000000);
  const actual = [hash(built.contract), hash(c.value), hash(built.assumptions), hash(runtime.evidence())];
  expect(actual).toEqual(pins.find(p => p[0] === mode)!.slice(1));
});
