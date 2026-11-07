import { systemsFixture, systemCommand } from "./systemsFixture";
import { quantities } from "./workloadFixture";
import { createSystemsModel2 } from "../src/model2/systems/run";

// Internal record updates are accounting proofs, not an exposed canvas intervention.
export function internalDnsEvidence() {
  const input = systemsFixture({count: 0, ttl: 10000, monitoring: false}), q = quantities(); input.arrivals = [];
  const resolver = input.resources.find(r => r.kind === "dns-resolver")!;
  if (resolver.kind !== "dns-resolver") throw Error("Expected resolver");
  resolver.cachePolicy = {version: 1, maxTtl: q.q("proof.maxTtl", 3000, "us")};
  const authority = input.resources.find(r => r.kind === "dns-authority")!;
  if (authority.kind !== "dns-authority") throw Error("Expected authority");
  authority.negativeTtl = q.q("proof.negativeTtl", 10000, "us");
  for (const [id, at, name] of [["cold", 0, "app.example"], ["negative", 0, "new.example"],
    ["warm", 500, "app.example"], ["old", 1500, "app.example"], ["still-negative", 1500, "new.example"],
    ["fresh", 4000, "app.example"], ["discovered", 4000, "new.example"]] as const) {
    systemCommand(input, id, at, "$caller", resolver.id, {kind: "resolve", name});
  }
  input.systems.interventions.push({id: "update", kind: "dns-record", target: authority.id, at: q.q("proof.updateAt", 1000, "us"),
    record: {...authority.records[0]!, generation: 2, addresses: [input.systems.identities.find(r => r.id === "other")!.address]}},
    {id: "create", kind: "dns-record", target: authority.id, at: q.q("proof.createAt", 1000, "us"), record: {...authority.records[0]!, name: "new.example"}});
  input.ledger.push(...q.ledger);
  const run = createSystemsModel2(input);
  return [900, 2000, 3500, 4500, run.horizon].map(at => {run.advanceTo(at); return run.evidence();});
}
if (import.meta.main) console.log(JSON.stringify(internalDnsEvidence()));
