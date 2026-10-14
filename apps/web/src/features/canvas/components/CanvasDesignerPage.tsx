import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { lazy, Suspense } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { DESIGNER_QUERY } from "../designerViewport";
import { WorkspaceRequired } from "./WorkspaceRequired";
import { useCanvasStore } from "../store/canvasStore";
import { SkipLink } from "@/components/shell/AppShell";
const DesignWorkspace = lazy(() => import("./designer/DesignWorkspace").then((m) => ({ default: m.DesignWorkspace })));
const LiveWorkspace = lazy(() => import("@/features/live/LiveWorkspace").then((m) => ({ default: m.LiveWorkspace })));

export function CanvasDesignerPage() {
  useCanvasPersistence();
  const supported = useMediaQuery(DESIGNER_QUERY);
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  return (
    <>
      <SkipLink />
      <Suspense fallback={<p role="status" className="p-6 text-sm">Opening workspace…</p>}>
        {supported ? activeRun ? <LiveWorkspace key={activeRun} deploymentId={activeRun} /> : <DesignWorkspace /> : <WorkspaceRequired />}
      </Suspense>
    </>
  );
}
