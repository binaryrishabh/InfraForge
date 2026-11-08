import { afterEach, expect, spyOn, test } from "bun:test";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CATALOG, findSku } from "@infraforge/catalog";
import type { Resource } from "@infraforge/domain/resource";
import { http } from "../src/client/httpClient";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { updateResource } from "../src/features/canvas/actions";
import { saveDesign } from "../src/features/canvas/designActions";
import { installDesign } from "../src/features/canvas/designLoader";
import { undo, redo } from "../src/features/canvas/history";
import { InstanceSection, InstanceSizeChoices } from "../src/features/canvas/components/inspector/InstanceSection";
import { compileProduct, contractFromDesign, requireKnown, type SavedProductDesign } from "@infraforge/simulation/internal-product";
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
      const { cores, quota } = assertDisplay({ id: "sized", type, size, x: 0, y: 0 }, `Generic ${(size ?? "small")[0]!.toUpperCase()}${(size ?? "small").slice(1)}`);
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

const db: Resource = { id: "db", type: "Database", x: 0, y: 0, size: "small", name: "Notes" };
const state = () => useCanvasStore.getState();
afterEach(() => { state().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });

// Exercise the actual radio callbacks without adding a DOM harness.
function choose(label: string) {
  const tree = InstanceSizeChoices({ resource: state().resources[0]!, disabled: false, provider: "aws" });
  type Label = ReactElement<{ children: [ReactElement<{ onChange(): void }>, ReactElement<{ children: ReactElement<{ children: string }>[] }> ] }>;
  const fieldset = tree.props.children[3] as ReactElement<{ children: [ReactElement, ReactElement<{ children: Label[] }>] }>;
  const option = fieldset.props.children[1].props.children.find(option => option.props.children[1].props.children[0]!.props.children === label);
  if (!option) throw Error(`Missing size ${label}`);
  option.props.children[0].props.onChange();
}

test("instance radios name generic cores and advertised catalog vCPU, default to small and lock natively", () => {
  for (const type of ["Database", "Virtual Machine"] as const) {
    const html = renderToStaticMarkup(<InstanceSection resource={{ ...db, type, size: undefined }} disabled={false} />);
    for (const text of ["Generic Small", "Generic Medium", "Generic Large", "1 modeled CPU core", "2 modeled CPU cores", "4 modeled CPU cores", "advertised vCPU", "Choosing one replaces the other", "same educational monthly estimate"]) expect(html).toContain(text);
    expect(html).toContain('<legend class="sr-only">Instance size</legend>');
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
    // Native labelled radios share a group, providing Tab/arrow/Space operation.
    expect(html).toContain('name="sku-db"');
    expect(html).not.toContain("qps"); expect(html).not.toContain("rps");
    expect(renderToStaticMarkup(<InstanceSection resource={{ ...db, type }} disabled />)).toContain('<fieldset class="mt-3" disabled="">');
  }
});

test("radio edits replace SKU or generic size, preserve the design, and undo/redo both fields", () => {
  state().loadLayout([db], [], "saved", "Notes");
  choose("Generic Medium");
  expect(state().resources).toEqual([{ ...db, size: "medium", skuId: undefined }]);
  expect(state().currentLayoutSaved).toBe(false);
  undo(); expect(state().resources[0]!.size).toBe("small");
  redo(); expect(state().resources[0]!.size).toBe("medium");
  choose("Generic Large"); expect(state().resources[0]!.size).toBe("large");
  // Read the actual catalog label so this test exercises the same option, without owning catalog copy.
  choose(findSku("db.m5.large")!.label);
  expect(state().resources[0]).toEqual({ ...db, size: undefined, skuId: "db.m5.large" });
  // Existing history coalesces consecutive edits to the same fields.
  undo(); expect(state().resources[0]).toEqual({ ...db, size: "small", skuId: undefined });
  redo(); choose("Generic Small");
  expect(state().resources[0]).toEqual({ ...db, size: "small", skuId: undefined });
  useCanvasStore.setState({ liveLocked: true }); choose("Generic Medium");
  expect(state().resources[0]!.size).toBe("small");
  useCanvasStore.setState({ liveLocked: false, isDeploying: true }); choose("Generic Large");
  expect(state().resources[0]!.size).toBe("small");
});

test("existing conflicting states show SKU precedence; invalid states never silently select generic small", () => {
  const both = { ...db, size: "large" as const, skuId: "db.m5.large" };
  const html = renderToStaticMarkup(<InstanceSection resource={both} disabled={false} />);
  expect(html).toContain("catalog choice overrides the saved generic size");
  expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
  state().loadLayout([both], [], "saved", "Notes");
  choose("Generic Medium"); expect(state().resources[0]!.skuId).toBeUndefined();
  undo(); expect(state().resources[0]).toEqual(both);
  for (const invalid of [{ ...db, size: "extra-large" as Resource["size"] }, { ...db, skuId: "unknown" }, { ...db, skuId: "c5.large" }]) {
    const bad = renderToStaticMarkup(<InstanceSection resource={invalid} disabled={false} />);
    expect(bad).toContain('role="alert"');
    expect(bad).not.toMatch(/type="radio"[^>]*checked=""/);
  }
  updateResource("db", { size: "extra-large" as Resource["size"] });
  expect(state().resources[0]).toEqual(both);
});

test("saveDesign sends generic size and installDesign reloads the returned JSON unchanged", async () => {
  useAuthStore.setState({ user: { id: "sizing-owner", name: "Owner", username: null, email: "sizing@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  state().loadLayout([db], [], "saved", "Notes");
  choose("Generic Medium");
  const response = JSON.parse(JSON.stringify({ id: "saved", name: "Notes", layout: { resources: [{ ...db, size: "medium" }], connectionLines: [], layoutVersion: 3 } }));
  const write = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: response } });
  try {
    const saved = await saveDesign();
    const savedLayout: unknown = JSON.parse(JSON.stringify(write.mock.calls[0]![1]));
    expect(savedLayout).toEqual({ layout: { resources: [{ ...db, size: "medium" }], connectionLines: [], layoutVersion: 3 } });
    state().clearCanvas(); installDesign(saved!);
    expect(state().resources).toEqual([{ ...db, size: "medium" }]);
    const reloaded = renderToStaticMarkup(<InstanceSection resource={state().resources[0]!} disabled={false} />);
    expect(reloaded).toMatch(/checked=""\/><span[^>]*><span[^>]*>Generic Medium/);
  } finally { write.mockRestore(); }
});
