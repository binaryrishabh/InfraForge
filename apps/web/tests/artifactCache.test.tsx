import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import { ARTIFACT_CACHE_HELP, type Resource } from "@infraforge/domain/resource";
import { AutoscalingSection } from "../src/features/canvas/components/inspector/AutoscalingSection";
import { Inspector } from "../src/features/canvas/components/inspector/Inspector";
import { StartupReadings } from "../src/features/reports/components/StartupReadings";
import { useCanvasStore } from "../src/features/canvas/store/canvasStore";
import { useAuthStore } from "../src/features/auth/store/auth.store";
import { undo, redo } from "../src/features/canvas/history";
import { saveDesign } from "../src/features/canvas/designActions";
import { http } from "../src/client/httpClient";

const app: Resource = {id: "app", type: "Virtual Machine", x: 0, y: 0, autoscaling: {enabled: true, minReplicas: 1, maxReplicas: 2, targetCpu: 50}};
const resource = () => useCanvasStore.getState().resources[0]!;
afterEach(() => {useCanvasStore.getState().clearCanvas(); useAuthStore.setState({user: null, status: "guest"});});
type Props = {label?: string; children?: ReactNode | ((ids: {id: string}) => ReactElement<{onChange(e: {target: {value: string}}): void}>)};
function number(value: string) {
  const tree = AutoscalingSection({resource: resource(), disabled: false});
  function find(node: ReactNode): ReactElement<Props> | undefined {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as ReactElement<Props>;
    return element.props.label === "Artifact cache capacity (bytes)" ? element : typeof element.props.children !== "function" ? find(element.props.children) : undefined;
  }
  const field = find(tree)!;
  if (typeof field.props.children !== "function") throw Error("Expected capacity field");
  field.props.children({id: "capacity-test"}).props.onChange({target: {value}});
}
test("existing autoscaling inspector exposes one saved byte control only on explicitly enabled VM pools", () => {
  const html = renderToStaticMarkup(<Inspector resource={app} />);
  for (const text of ["Artifact cache capacity (bytes)", 'max="9007199254740991"', 'min="1"', 'step="1"', 'placeholder="Resource profile"']) expect(html).toContain(text);
  expect(html).toContain(ARTIFACT_CACHE_HELP.replaceAll("'", "&#x27;"));
  for (const r of [{...app, type: "Load Balancer" as const}, {...app, autoscaling: {enabled: false}}, {...app, autoscaling: undefined}]) expect(renderToStaticMarkup(<Inspector resource={r} />)).not.toContain("Artifact cache capacity (bytes)");
});
test("capacity edits reject invalid values, support undo/redo and blank restores the old profile", () => {
  useCanvasStore.getState().loadLayout([app], [], "layout", "Startup"); number("256");
  for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) number(value);
  expect(resource().artifactCachePolicy).toEqual({version: 1, capacityBytes: 256});
  undo(); expect(resource().artifactCachePolicy).toBeUndefined(); redo(); expect(resource().artifactCachePolicy?.capacityBytes).toBe(256);
  number(""); expect(resource().artifactCachePolicy).toBeUndefined();
});
for (const lock of ["liveLocked", "isDeploying"] as const) test(`artifact bytes honor ${lock}`, () => {
  useCanvasStore.getState().loadLayout([app], [], "layout", "Startup"); useCanvasStore.setState({[lock]: true});
  number("4096"); expect(resource().artifactCachePolicy).toBeUndefined();
  expect(renderToStaticMarkup(<AutoscalingSection resource={resource()} disabled />)).toContain('disabled=""');
});
test("capacity persists through save/reload and reports keep historical capacity Unknown", async () => {
  useAuthStore.setState({user: {id: "owner", name: "Owner", username: null, email: "owner@infraforge.test", emailVerified: true, createdAt: new Date(0).toISOString()}, status: "authenticated"});
  useCanvasStore.getState().loadLayout([app], [], "layout", "Startup"); number("4096");
  const saved = spyOn(http, "put").mockResolvedValue({data: {updatedInfrastructure: {id: "layout", name: "Startup"}}});
  try {
    await saveDesign(); const payload = JSON.parse(JSON.stringify(saved.mock.calls[0]![1])) as {layout: {resources: Resource[]}};
    expect(payload.layout.resources[0]!.artifactCachePolicy).toEqual({version: 1, capacityBytes: 4096});
    useCanvasStore.getState().clearCanvas(); useCanvasStore.getState().loadLayout(payload.layout.resources, [], "layout", "Startup");
    expect(resource().artifactCachePolicy).toEqual({version: 1, capacityBytes: 4096});
  } finally {saved.mockRestore();}
  for (const capacityBytes of [undefined, null, 256, 4096]) {
    const html = renderToStaticMarkup(<StartupReadings id="app" metrics={{version: 1, clients: [{id: "app#1/image", capacityBytes}]}} />);
    expect(html).toContain(`Artifact cache capacity (bytes)</dt><dd class="if-num break-all">${capacityBytes == null ? "Unknown" : capacityBytes.toLocaleString()}</dd>`);
  }
});
