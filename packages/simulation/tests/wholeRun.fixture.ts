import { latencyDesign } from "./latency.fixture";
import { compileProduct, contractFromDesign, currentAdapterProfiles } from "../src/internalProduct";
import { withRunLength } from "../src/model2/product/runContract";

export function wholeRunFixture(marked = true, timeout = 20) {
  const design = latencyDesign(true);
  design.workload.workloadDynamics = { version: 1, arrivalProcess: "poisson", applicationCpuCv: 0.5 };
  design.workload.clientRetry!.attemptTimeoutMs = timeout;
  const b = contractFromDesign(design, { adapterProfiles: [...currentAdapterProfiles(design.resources, design.workload), ...(marked ? ["traffic-evidence/2" as const] : [])] });
  if ("refused" in b) throw Error(JSON.stringify(b));
  const c = compileProduct(design, withRunLength(b.contract, 4, "whole-run-proof"));
  if (!c.ok) throw Error(JSON.stringify(c));
  return { design, compiled: c.value };
}
