import { useCanvasStore } from "../store/canvasStore";
import { useCanvasResourceActions } from "../hooks/useCanvasResourceActions";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

export function CanvasConfigPanelWrapper() {
  const resource = useCanvasStore((s) =>
    s.selectedResourceForConfigId
      ? s.resources.find((r) => r.id === s.selectedResourceForConfigId)
      : undefined
  );
  const { handleUpdateCanvasResource } = useCanvasResourceActions();

  if (!resource) {
    return null;
  }

  return (
    <ResourceConfigPanel
      resource={resource}
      onClose={() => useCanvasStore.getState().setSelectedResourceForConfigId(null)}
      onUpdateResource={handleUpdateCanvasResource}
    />
  );
}