import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { Resource } from "@infraforge/domain/resource";
import { LbSelectionSection } from "../src/features/canvas/components/inspector/LbSelectionSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { updateResource } from "../src/features/canvas/actions";
import { undo, redo } from "../src/features/canvas/history";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const lb: Resource = { id: "lb", type: "Load Balancer", x: 0, y: 0 };
afterEach(() => { useCanvasStore.getState().clearCanvas(); useAuthStore.setState({ user: null, status: "guest" }); });
test("selection control uses the existing default and only appears on load balancers", () => {
  const html = renderToStaticMarkup(<Inspector resource={lb} />);
  for (const text of ["Selection policy", "Default (round robin)", "Least outstanding"]) expect(html).toContain(text);
  expect(renderToStaticMarkup(<Inspector resource={{ ...lb, type: "Virtual Machine" }} />)).not.toContain("Selection policy");
  expect(renderToStaticMarkup(<LbSelectionSection resource={lb} disabled />)).toContain('disabled=""');
});
test("selector edits, clearing, undo/redo and run/deploy locks preserve intent", () => {
  useCanvasStore.getState().loadLayout([lb], [], "layout", "Selection");
  const edit = (value: string) => {
    const tree = LbSelectionSection({ resource: useCanvasStore.getState().resources[0]!, disabled: false });
    const field = tree.props.children as ReactElement<{ children: (ids: { id: string }) => ReactElement<{ onChange: (event: { target: { value: string } }) => void }> }>;
    field.props.children({ id: "selection" }).props.onChange({ target: { value } });
  };
  edit("least-outstanding"); expect(useCanvasStore.getState().resources[0]!.lbSelection?.policy).toBe("least-outstanding");
  undo(); expect(useCanvasStore.getState().resources[0]!.lbSelection).toBeUndefined(); redo();
  for (const lock of ["liveLocked", "isDeploying"] as const) {
    useCanvasStore.setState({ [lock]: true }); edit("round-robin");
    expect(useCanvasStore.getState().resources[0]!.lbSelection?.policy).toBe("least-outstanding");
    useCanvasStore.setState({ [lock]: false });
  }
  edit("random"); expect(useCanvasStore.getState().resources[0]!.lbSelection?.policy).toBe("least-outstanding");
  edit(""); expect(useCanvasStore.getState().resources[0]!.lbSelection).toBeUndefined();
  updateResource("lb", { lbSelection: { version: 1, policy: "round-robin" } });
  expect(useCanvasStore.getState().resources[0]!.lbSelection?.policy).toBe("round-robin");
});
for (const policy of [undefined, "round-robin", "least-outstanding"] as const) test(`save/reload preserves selection ${policy}`, async () => {
  useAuthStore.setState({ user: { id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString() }, status: "authenticated" });
  useCanvasStore.getState().loadLayout([{ ...lb, ...(policy ? { lbSelection: { version: 1 as const, policy } } : {}) }], [], "layout", "Selection");
  const saved = spyOn(http, "put").mockResolvedValue({ data: { updatedInfrastructure: { id: "layout", name: "Selection" } } });
  try {
    await saveDesign();
    const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as { layout: { resources: Resource[] } };
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Selection");
    expect(useCanvasStore.getState().resources[0]!.lbSelection).toEqual(policy ? { version: 1, policy } : undefined);
  } finally { saved.mockRestore(); }
});
