import { useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";

// Zero-subscription persistence: restore once on mount via getState(), then
// persist via store.subscribe() so this hook never re-renders its host.
export function useCanvasPersistence() {
  // One-time restore from localStorage on mount
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

  // Persist to localStorage on every store change — the subscribe callback
  // receives the full state, so no React subscriptions are needed at all.
  useEffect(() => {
    const unsubscribe = useCanvasStore.subscribe((state) => {
      if (!state.isInitialized) return;
      localStorage.setItem(
        "Infraforge_Infrastucture_Draft",
        JSON.stringify({
          canvasResources: state.resources,
          connectionLines: state.connectionLines,
          currentLayoutId: state.currentLayoutId,
          currentLayoutName: state.currentLayoutName,
          saved: state.currentLayoutSaved,
        }),
      );
    });
    return unsubscribe;
  }, []);
}