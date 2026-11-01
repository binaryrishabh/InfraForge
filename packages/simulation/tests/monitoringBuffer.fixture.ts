import type { MonitoringPolicy } from "@infraforge/domain/resource";
import { monitoringSetup, type MonitoringMode } from "./monitoringCadence.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

export function bufferSetup(mode: MonitoringMode | "slow-export" = "vm", policy?: MonitoringPolicy) {
  const f = monitoringSetup(mode === "slow-export" ? "vm" : mode, policy);
  if (mode === "slow-export") {
    const q = quantities(), transport = structuredClone(f.contract.transports.assumed!);
    transport.links.find(l => l.id === "response")!.propagation = q.q("proof.export.response", 2000000, "us");
    f.contract.transports["slow-export"] = transport;
    f.contract.nodes.monitor!.internalEdges.find(e => e.purpose === "telemetry-export")!.transport = "slow-export";
    f.contract.ledger.push(...q.ledger);
  }
  const compiled = compileProduct(f.saved, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return { ...f, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
