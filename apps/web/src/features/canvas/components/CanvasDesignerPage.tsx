import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { lazy, Suspense } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { SkipLink } from "@/components/shell/AppShell";
const DesignWorkspace = lazy(() => import("./designer/DesignWorkspace").then((m) => ({ default: m.DesignWorkspace })));
const LiveWorkspace = lazy(() => import("@/features/live/LiveWorkspace").then((m) => ({ default: m.LiveWorkspace })));

// Both workspaces adapt to the window: panels dock when there is room and open as sheets when there is not.
export function CanvasDesignerPage() {
  useCanvasPersistence();
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  return (
    <>
      <SkipLink />
      <Suspense fallback={<p role="status" className="p-6 text-sm">Opening workspace…</p>}>
        {activeRun ? <LiveWorkspace key={activeRun} deploymentId={activeRun} /> : <DesignWorkspace />}
      </Suspense>
    </>
  );
}
