import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG } from "@infraforge/catalog";
import type { Resource } from "@infraforge/domain/resource";
import { compileProduct, contractFromDesign, requireKnown, type SavedProductDesign } from "@infraforge/simulation/internal-product";
import { InstanceSection } from "../src/features/canvas/components/inspector/InstanceSection";
import { NodeCard } from "../src/features/canvas/components/node/NodeCard";
import { declaredCapacity } from "../src/features/canvas/components/node/nodeFacts";

function compiledCpu(resource: Resource) {
  const database = resource.type === "Database";
  const design: SavedProductDesign = {
    schema: "infraforge-saved-design/1",
    resources: database ? [{ id: "app", type: "Virtual Machine", x: 0, y: 0 }, resource] : [resource],
    connections: database ? [{ id: "edge", sourceId: "app", sourceType: "Virtual Machine", targetId: resource.id, targetType: "Database", port: 5432 }] : [],
    workload: { targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "light" },
  };
  const built = contractFromDesign(design);
  if ("refused" in built) throw Error(JSON.stringify(built.refused));
  const compiled = compileProduct(design, built.contract);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const engine = compiled.value.input.resources.find(r => r.id === resource.id);
  const execution = engine?.kind === "compute" ? engine : engine?.kind === "relational" ? engine.execution : undefined;
  if (!execution) throw Error("Missing compiled CPU");
  return { cores: requireKnown(execution.cores, "cores"), quota: execution.quota };
}

const cpuText = (cores: number) => `${cores} modeled CPU ${cores === 1 ? "core" : "cores"}`;

// Compare the rendered option itself, not a second display formula or only an intermediate helper.
function assertDisplay(resource: Resource, label: string) {
  const { cores, quota } = compiledCpu(resource);
  const html = renderToStaticMarkup(<InstanceSection resource={resource} disabled={false} />);
  const option = html.split("</label>").find(part => part.includes(`>${label}</span>`));
  expect(option).toBeDefined();
  expect(option).toContain(`>${cpuText(cores)}`);
  expect(html).not.toMatch(/\b[qr]ps\b/);
  expect(declaredCapacity(resource)).toEqual({ value: cores, unit: cores === 1 ? "modeled CPU core" : "modeled CPU cores" });
  return { cores, quota };
}

for (const sku of CATALOG) test(`inspector and canvas match compiled CPU: ${sku.skuId} (${sku.family})`, () => {
  const resource: Resource = { id: "sized", type: sku.category, skuId: sku.skuId, x: 0, y: 0 };
  const { cores, quota } = assertDisplay(resource, sku.label);
  expect(cores).toBe(sku.vCpu);
  expect(quota).toBeUndefined(); // Burstable SKUs have no automatic baseline quota.
  // A saved generic size must not override a selected catalog SKU.
  assertDisplay({ ...resource, size: "large" }, sku.label);
});

for (const type of ["Virtual Machine", "Database"] as const) {
  for (const [size, expected] of [[undefined, 1], ["small", 1], ["medium", 2], ["large", 4]] as const) {
    test(`generic ${type} ${size ?? "default"} shows its compiled size`, () => {
      const { cores, quota } = assertDisplay({ id: "sized", type, size, x: 0, y: 0 }, "Generic");
      expect(cores).toBe(expected); expect(quota).toBeUndefined();
    });
  }
}

test("database card states educational sizing and throughput limits, retaining session and price information", () => {
  const resource: Resource = { id: "db", type: "Database", skuId: "db.t3.micro", x: 0, y: 0 };
  const html = renderToStaticMarkup(<InstanceSection resource={resource} disabled />);
  for (const text of ["Educational model sizing", "Throughput depends on workload and limits", "Burst credits and baseline throttling are not simulated", "2 modeled CPU cores · 85 connections", "$12.40/mo", 'disabled=""']) expect(html).toContain(text);
  expect(html).not.toContain("25 qps"); expect(html).not.toContain("250 qps");
  const node = renderToStaticMarkup(<NodeCard resource={resource} mode="design" />);
  expect(node).toContain(">2 <"); expect(node).toContain("modeled CPU cores"); expect(node).not.toContain("qps");
});

test("explicit application quota stays separate from the modeled core count", () => {
  const resource: Resource = { id: "sized", type: "Virtual Machine", skuId: "t3.micro", vmCpuQuota: { version: 1, limitPercent: 25 }, x: 0, y: 0 };
  const { cores, quota } = assertDisplay(resource, CATALOG.find(s => s.skuId === "t3.micro")!.label);
  expect(cores).toBe(2); expect(quota).toBeDefined();
  expect(requireKnown(quota!.budget, "cpu-us")).toBe(50000);
  expect(requireKnown(quota!.period, "us")).toBe(100000);
});

test("an invalid or wrong-category catalog choice stays Unknown on the canvas and refuses compilation", () => {
  for (const skuId of ["missing-sku", "db.t3.micro"]) {
    const resource: Resource = { id: "sized", type: "Virtual Machine", skuId, x: 0, y: 0 };
    expect(declaredCapacity(resource).value).toBeNull();
    expect(() => compiledCpu(resource)).toThrow();
    const node = renderToStaticMarkup(<NodeCard resource={resource} mode="design" />);
    expect(node).toContain("Unknown");
  }
});
