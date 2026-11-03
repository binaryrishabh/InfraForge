import { expect, test } from "bun:test";
import { lbDesign, prepareLb } from "./lbAdmission.fixture";
import { contractFromDesign, currentAdapterProfiles } from "../src/model2/product/fromDesign";
import { compileProduct } from "../src/model2/product/compiler";

test("saved selection binds the engine and refuses missing, duplicate or mismatched capture", () => {
  for (const policy of ["round-robin", "least-outstanding"] as const) {
    const d = lbDesign(); d.resources[0]!.lbSelection = { version: 1, policy };
    expect(currentAdapterProfiles(d.resources)).toEqual(["lb-selection/1"]);
    for (const adapterProfiles of [[], ["lb-selection/1", "lb-selection/1"]] as const) expect(contractFromDesign(d, { adapterProfiles })).toHaveProperty("refused");
    const f = prepareLb(d);
    expect(f.compiled.input.resources.find(r => r.kind === "load-balancer")).toHaveProperty("policy", policy);
    const lb = f.contract.nodes.lb!.resources.find(r => r.config.kind === "load-balancer")!.config;
    if (lb.kind !== "load-balancer") throw Error("Expected load balancer");
    lb.policy = policy === "round-robin" ? "least-outstanding" : "round-robin";
    expect(compileProduct(d, f.contract).ok).toBe(false);
  }
  expect(contractFromDesign(lbDesign(), { adapterProfiles: ["lb-selection/1"] })).toHaveProperty("refused");
});

test("least outstanding shifts requests away from a backend with slower service", () => {
  const run = (policy: "round-robin" | "least-outstanding") => {
    const d = lbDesign(); d.resources[0]!.lbSelection = { version: 1, policy };
    d.resources[1]!.size = "small";
    d.resources[1]!.vmCpuQuota = { version: 1, limitPercent: 1 };
    d.resources.push({ id: "fast", type: "Virtual Machine", x: 2, y: 0, size: "large" });
    d.connections.push({ ...d.connections[0]!, id: "fast-edge", targetId: "fast" });
    d.workload.targetThroughput = 12000;
    const f = prepareLb(d); f.runtime.advanceTo(3000000); return f.runtime.evidence();
  };
  const round = run("round-robin"), least = run("least-outstanding");
  const count = (e: typeof round, id: string) => e.network.loadBalancers[0]!.backends.find(b => b.id === id)!.selected;
  expect(Math.abs(count(round, "app") - count(round, "fast"))).toBeLessThanOrEqual(1);
  expect(count(least, "fast")).toBeGreaterThan(count(round, "fast"));
  expect(count(least, "app")).toBeLessThan(count(round, "app"));
  console.info("lb-selection", JSON.stringify({ round: round.network.loadBalancers[0]!.backends, least: least.network.loadBalancers[0]!.backends }));
});
