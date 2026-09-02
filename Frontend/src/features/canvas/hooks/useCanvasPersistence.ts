import { useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";

export function useCanvasPersistence() {
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const currentLayoutSaved = useCanvasStore((s) => s.currentLayoutSaved);
  const isInitialized = useCanvasStore((s) => s.isInitialized);

  useEffect(() => {
    const infra = localStorage.getItem("Infraforge_Infrastucture_Draft");
    if (infra) {
      const parsed = JSON.parse(infra);
      const store = useCanvasStore.getState();
      store.setResources(parsed.canvasResources);
      store.setConnectionLines(parsed.connectionLines || []);
      store.setCurrentLayoutId(parsed.currentLayoutId);
      store.setCurrentLayoutName(parsed.currentLayoutName);
      store.setCurrentLayoutSaved(parsed.saved);
    }
    useCanvasStore.getState().setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized) return;
    localStorage.setItem(
      "Infraforge_Infrastucture_Draft",
      JSON.stringify({
        canvasResources: resources,
        connectionLines,
        currentLayoutId,
        currentLayoutName,
        saved: currentLayoutSaved,
      }),
    );
  }, [resources, currentLayoutId, currentLayoutName, connectionLines, currentLayoutSaved, isInitialized]);
}