import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { useCanvasKeyboardShortcuts } from "../hooks/useCanvasKeyboardShortcuts";
import { useCanvasStore } from "../store/canvasStore";
import { DesignWorkspace } from "./designer/DesignWorkspace";
import { LiveWorkspace } from "@/features/live/LiveWorkspace";
import { SkipLink } from "@/components/shell/AppShell";

export function CanvasDesignerPage() {
  useCanvasPersistence();
  useCanvasKeyboardShortcuts();
  const activeRun = useCanvasStore((s) => s.activeDeploymentId);
  return (
    <>
      <SkipLink />
      {activeRun ? <LiveWorkspace key={activeRun} deploymentId={activeRun} /> : <DesignWorkspace />}
    </>
  );
}
