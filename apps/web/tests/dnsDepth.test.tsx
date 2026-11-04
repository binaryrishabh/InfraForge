import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { DNS_CACHE_HELP, type Resource } from "@infraforge/domain/resource";
import { DnsCacheSection } from "../src/features/canvas/components/inspector/DnsCacheSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const dns: Resource = { id: "dns", type: "DNS", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
function edit(value: string) {
  const tree = DnsCacheSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
  const field = tree.props.children as ReactElement<{ children: (ids: { id: string }) => ReactElement<{ onChange: (e: { target: { value: string } }) => void }> }>;
  field.props.children({ id: "ttl-test" }).props.onChange({ target: { value } });
}

test("DNS inspector exposes TTL with bounds, blank default and policy explanation", () => {
  const html = renderToStaticMarkup(<Inspector resource={dns} />);
  for (const text of ["Maximum cached TTL (seconds)", DNS_CACHE_HELP, 'min="1"', 'max="3600"', 'placeholder="Authority TTL"']) expect(html).toContain(text);
  expect(dns).not.toHaveProperty("dnsCachePolicy");
  useCanvasStore.getState().loadLayout([dns], [], "layout", "DNS"); edit("25");
  expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy).toEqual({ version: 1, maxTtlSeconds: 25 });
  undo(); expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy).toBeUndefined();
  redo(); expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy?.maxTtlSeconds).toBe(25);
  for (const bad of ["0", "3601", "1.5"]) edit(bad);
  expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy?.maxTtlSeconds).toBe(25);
  edit(""); expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy).toBeUndefined();
});

for (const lock of ["liveLocked", "isDeploying"] as const) test(`DNS TTL respects ${lock}`, () => {
  useCanvasStore.getState().loadLayout([dns], [], "layout", "DNS"); useCanvasStore.setState({ [lock]: true }); edit("25");
  expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy).toBeUndefined();
  expect(renderToStaticMarkup(<DnsCacheSection resource={dns} disabled />)).toContain('disabled=""');
});

for (const dnsCachePolicy of [undefined, { version: 1 as const, maxTtlSeconds: 60 }, { version: 1 as const, maxTtlSeconds: 3600 }]) test(`DNS TTL save/reload: ${JSON.stringify(dnsCachePolicy)}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...dns, ...(dnsCachePolicy ? { dnsCachePolicy } : {}) }], [], "layout", "DNS");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "DNS" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    expect(payload.layout.resources[0]!.dnsCachePolicy).toEqual(dnsCachePolicy);
    if (!dnsCachePolicy) expect(payload.layout.resources[0]).not.toHaveProperty("dnsCachePolicy");
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "DNS");
    expect(useCanvasStore.getState().resources[0]!.dnsCachePolicy).toEqual(dnsCachePolicy);
  } finally { saved.mockRestore(); }
});
