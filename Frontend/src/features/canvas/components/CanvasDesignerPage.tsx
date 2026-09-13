import { useCanvasPersistence } from "../hooks/useCanvasPersistence";
import { useCanvasKeyboardShortcuts } from "../hooks/useCanvasKeyboardShortcuts";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasTopbar } from "../topbar/CanvasTopbar";
import { CanvasLiveMode } from "./CanvasLiveMode";
import { ShellMenu } from "@/components/shell/ShellMenu";
import { useCanvasStore } from "../store/canvasStore";

export function CanvasDesignerPage() {
  useCanvasPersistence();
  useCanvasKeyboardShortcuts();
  const activeDeploymentId = useCanvasStore((s) => s.activeDeploymentId);

  if (activeDeploymentId) {
    return <CanvasLiveMode deploymentId={activeDeploymentId} />;
  }

  return (
    <CanvasSurface className="h-screen bg-[#0f1117] text-white" showEmptyState>
      {/* Design-only chrome: the floating action topbar and shell menu. */}
      <CanvasTopbar />
      <div className="absolute top-3 right-4 z-40">
        <ShellMenu />
      </div>
    </CanvasSurface>
  );
}