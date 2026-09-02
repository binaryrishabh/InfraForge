import { useCanvasStore } from "../store/canvasStore";
import { useCanvasResourceActions } from "../hooks/useCanvasResourceActions";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

export function CanvasConfigPanelWrapper() {
  const selectedResourceForConfig = useCanvasStore((s) => s.selectedResourceForConfigId);
  const resources = useCanvasStore((s) => s.resources);
  const setSelectedResourceForConfig = useCanvasStore((s) => s.setSelectedResourceForConfigId);
  const { handleUpdateCanvasResource } = useCanvasResourceActions();

  if (!selectedResourceForConfig) return null;
  const resource = resources.find((r) => r.id === selectedResourceForConfig);
  if (!resource) return null;

  return (
    <ResourceConfigPanel
      resource={resource}
      onClose={() => setSelectedResourceForConfig(null)}
      onUpdateResource={handleUpdateCanvasResource}
    />
  );
}