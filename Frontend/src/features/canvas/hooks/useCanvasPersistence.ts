import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/canvasStore";

export function useCanvasPersistence() {
  /* ------Save the current state of canvas resources into localstorage prevents vanish on reloads----- */
  // state tracking for we have initialized the current state from localstorage or not
  const [isInitialized, setIsInitialized] = useState(false);

  // Store reads for the save effect — the store is the single source of truth
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const currentLayoutId = useCanvasStore((s) => s.currentLayoutId);
  const currentLayoutName = useCanvasStore((s) => s.currentLayoutName);
  const currentLayoutSaved = useCanvasStore((s) => s.currentLayoutSaved);

  // Restore on mount — write straight into the store (via getState())
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
    setIsInitialized(true); // Mark i.e. we got the current state from localstorage
  }, []);

  // Save to localStorage current infrastructure state, but only after getting the current state from browser
  useEffect(() => {
    if (!isInitialized) return; // ← Skip on first render
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
  }, [
    resources,
    currentLayoutId,
    currentLayoutName,
    connectionLines,
    currentLayoutSaved,
  ]);

  return {
    isInitialized,
    setIsInitialized,
  };
}