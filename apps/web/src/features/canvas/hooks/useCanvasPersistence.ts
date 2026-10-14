import { useEffect } from "react";
import type { ConnectionLine, Resource } from "@infraforge/domain/resource";
import { useAuthStore } from "../../auth/store/auth.store";
import { draftKey } from "../../auth/drafts";
import { useCanvasStore } from "../store/canvasStore";
import {
  CARD_LAYOUT_VERSION,
  migrateLayoutToCardScale,
} from "../utils/layoutMigration";

interface Draft {
  canvasResources?: Resource[]; connectionLines?: ConnectionLine[]; currentLayoutId?: string | null; currentLayoutName?: string | null;
  saved?: boolean; currentChallengeId?: unknown; currentChallengeVersion?: unknown; layoutVersion?: number;
}

function readDraft(userId: string): Draft | null {
  try { return JSON.parse(localStorage.getItem(draftKey(userId)) ?? "null"); } catch { return null; }
}

// Zero-subscription persistence: restore once on mount via getState(), then
// persist via store.subscribe() so this hook never re-renders its host.
export function useCanvasPersistence() {
  const userId = useAuthStore((state) => state.user?.id);
  // One-time restore from localStorage on mount, migrating legacy coordinates.
  // Guard: if the store is already initialized (e.g. the dashboard just loaded
  // a live reattach layout), do NOT overwrite it with a stale local draft.
  useEffect(() => {
    if (!userId || useCanvasStore.getState().isInitialized) return;

    const parsed = readDraft(userId);
    if (parsed) {
      const store = useCanvasStore.getState();
      const migratedResources = migrateLayoutToCardScale(
        parsed.canvasResources || [],
        parsed.layoutVersion,
      );
      store.setResources(migratedResources);
      store.setConnectionLines(parsed.connectionLines || []);
      store.setCurrentLayoutId(parsed.currentLayoutId ?? null);
      store.setCurrentLayoutName(parsed.currentLayoutName ?? null);
      store.setCurrentLayoutSaved(parsed.saved ?? true);
      // Only a UI hint; attempts are verified by the server against the saved design.
      store.setCurrentChallengeId(typeof parsed.currentChallengeId === "string" ? parsed.currentChallengeId : null,
        typeof parsed.currentChallengeVersion === "number" ? parsed.currentChallengeVersion : null);
    }
    useCanvasStore.getState().setIsInitialized(true);
  }, [userId]);

  // Persist to localStorage on every store change — debounced by 300ms so a
  // drag (which fires ~60 store updates/sec) does not thrash localStorage.
  useEffect(() => {
    if (!userId) return;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useCanvasStore.subscribe((state) => {
      if (!state.isInitialized) return;

      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (useAuthStore.getState().user?.id !== userId) return;
        try { localStorage.setItem(
          draftKey(userId),
          JSON.stringify({
            canvasResources: state.resources,
            connectionLines: state.connectionLines,
            currentLayoutId: state.currentLayoutId,
            currentLayoutName: state.currentLayoutName,
            saved: state.currentLayoutSaved,
            currentChallengeId: state.currentChallengeId,
            currentChallengeVersion: state.currentChallengeVersion,
            layoutVersion: CARD_LAYOUT_VERSION,
          }),
        ); } catch { /* storage unavailable: the canvas still works */ }
      }, 300);
    });

    return () => {
      unsubscribe();
      if (saveTimeout) clearTimeout(saveTimeout);
    };
  }, [userId]);
}