import { useCallback } from "react";
import { useCanvasStore } from "../store/canvasStore";
import { useCanvasResourceActions } from "../hooks/useCanvasResourceActions";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

/* Always mounted so the drawer can slide in and out; `open` drives the
   transform and the shell owns the outside-click dismissal. */
export function CanvasConfigPanelWrapper() {
  const resource = useCanvasStore((s) =>
    s.selectedResourceForConfigId
      ? s.resources.find((r) => r.id === s.selectedResourceForConfigId)
      : undefined
  );
  const { handleUpdateCanvasResource } = useCanvasResourceActions();

  const handleClose = useCallback(() => {
    useCanvasStore.getState().setSelectedResourceForConfigId(null);
  }, []);

  return (
    <ResourceConfigPanel
      resource={resource}
      open={!!resource}
      onClose={handleClose}
      onUpdateResource={handleUpdateCanvasResource}
    />
  );
}