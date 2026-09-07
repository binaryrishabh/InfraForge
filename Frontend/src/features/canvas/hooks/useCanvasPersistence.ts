import { useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";
import {
  CARD_LAYOUT_VERSION,
  migrateLayoutToCardScale,
} from "../utils/layoutMigration";

// Zero-subscription persistence: restore once on mount via getState(), then
// persist via store.subscribe() so this hook never re-renders its host.
export function useCanvasPersistence() {
  // One-time restore from localStorage on mount, migrating legacy coordinates.
  useEffect(() => {
    const infra = localStorage.getItem("Infraforge_Infrastucture_Draft");
    if (infra) {
      const parsed = JSON.parse(infra);
      const store = useCanvasStore.getState();
      const migratedResources = migrateLayoutToCardScale(
        parsed.canvasResources || [],
        parsed.layoutVersion,
      );
      store.setResources(migratedResources);
      store.setConnectionLines(parsed.connectionLines || []);
      store.setCurrentLayoutId(parsed.currentLayoutId);
      store.setCurrentLayoutName(parsed.currentLayoutName);
      store.setCurrentLayoutSaved(parsed.saved);
    }
    useCanvasStore.getState().setIsInitialized(true);
  }, []);

  // Persist to localStorage on every store change — debounced by 300ms so a
  // drag (which fires ~60 store updates/sec) does not thrash localStorage.
  useEffect(() => {
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useCanvasStore.subscribe((state) => {
      if (!state.isInitialized) return;
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        localStorage.setItem(
          "Infraforge_Infrastucture_Draft",
          JSON.stringify({
            canvasResources: state.resources,
            connectionLines: state.connectionLines,
            currentLayoutId: state.currentLayoutId,
            currentLayoutName: state.currentLayoutName,
            saved: state.currentLayoutSaved,
            layoutVersion: CARD_LAYOUT_VERSION,
          }),
        );
      }, 300);
    });
    return () => {
      unsubscribe();
      if (saveTimeout) clearTimeout(saveTimeout);
    };
  }, []);
}