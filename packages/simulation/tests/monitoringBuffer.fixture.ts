import type { MonitoringPolicy } from "@infraforge/domain/resource";
import { monitoringSetup, type MonitoringMode } from "./monitoringCadence.fixture";
import { compileProduct } from "../src/model2/product/compiler";
import { createProductModel2 } from "../src/model2/product/run";
import { quantities } from "./workloadFixture";

export function bufferSetup(mode: MonitoringMode | "slow-export" | "collection-stop" | "backend-full" = "vm", policy?: MonitoringPolicy) {
  const f = monitoringSetup(mode === "slow-export" || mode === "collection-stop" || mode === "backend-full" ? "vm" : mode, policy);
  if (mode === "slow-export") {
    const q = quantities(), transport = structuredClone(f.contract.transports.assumed!);
    transport.links.find(l => l.id === "response")!.propagation = q.q("proof.export.response", 2000000, "us");
    f.contract.transports["slow-export"] = transport;
    f.contract.nodes.monitor!.internalEdges.find(e => e.purpose === "telemetry-export")!.transport = "slow-export";
    f.contract.ledger.push(...q.ledger);
  }
  if (mode === "collection-stop") {
    const q = quantities();
    f.contract.faults.push({ id: "stop-collecting", kind: "Crash", target: "vm", at: q.q("proof.stop.at", 25000000, "us"), duration: q.q("proof.stop.duration", 100000000, "us"), restart: q.q("proof.stop.restart", 1000, "us"), profile: "retain-logical-state/1" });
    f.contract.ledger.push(...q.ledger);
  }
  if (mode === "backend-full") {
    const q = quantities(), backend = f.contract.nodes.monitor!.resources.find(r => r.config.kind === "telemetry-backend")!.config;
    if (backend.kind !== "telemetry-backend") throw Error("Expected backend");
    backend.samples = q.q("proof.backend.samples", 2, "count"); f.contract.ledger.push(...q.ledger);
  }
  const compiled = compileProduct(f.saved, f.contract); if (!compiled.ok) throw Error(JSON.stringify(compiled));
  return { ...f, compiled: compiled.value, runtime: createProductModel2(compiled.value) };
}
