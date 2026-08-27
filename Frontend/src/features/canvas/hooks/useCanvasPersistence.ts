import { useEffect, useState } from "react";
import type { Resource } from "@shared/interface/Resource.interface";
import type { ConnectionLine } from "@shared/interface/ConnectionLine.interface";

interface UseCanvasPersistenceProps {
  canvasResources: Resource[];
  connectionLines: ConnectionLine[];
  currentLayoutId: string | null;
  currentLayoutName: string | null;
  currentLayoutSaved: boolean;
  setCanvasResources: (resources: Resource[]) => void;
  setCurrentLayoutId: (id: string | null) => void;
  setCurrentLayoutName: (name: string | null) => void;
  setCurrentLayoutSaved: (saved: boolean) => void;
  setConnectionLines: (lines: ConnectionLine[]) => void;
}

export function useCanvasPersistence({
  canvasResources,
  connectionLines,
  currentLayoutId,
  currentLayoutName,
  currentLayoutSaved,
  setCanvasResources,
  setCurrentLayoutId,
  setCurrentLayoutName,
  setCurrentLayoutSaved,
  setConnectionLines,
}: UseCanvasPersistenceProps) {
  /* ------Save the current state of canvas resources into localstorage prevents vanish on reloads----- */
  // state tracking for we have initialized the current state from localstorage or not
  const [isInitialized, setIsInitialized] = useState(false);

  // Restore on mount
  // Fetch for the first time when browser loads the page or reloads the page
  useEffect(() => {
    const infra = localStorage.getItem("Infraforge_Infrastucture_Draft");
    if (infra) {
      const parsed = JSON.parse(infra);
      setCanvasResources(parsed.canvasResources);
      setCurrentLayoutId(parsed.currentLayoutId);
      setCurrentLayoutName(parsed.currentLayoutName);
      setCurrentLayoutSaved(parsed.saved);
      setConnectionLines(parsed.connectionLines || []);
    }
    setIsInitialized(true); // Mark i.e. we got the current state from localstorage
  }, []);

  // Save to localStorage current infrastaructure state, but only after getting the current state from browser
  useEffect(() => {
    if (!isInitialized) return; // ← Skip on first render

    localStorage.setItem(
      "Infraforge_Infrastucture_Draft",
      JSON.stringify({
        canvasResources,
        connectionLines,
        currentLayoutId,
        currentLayoutName,
        saved: currentLayoutSaved,
      }),
    );
  }, [
    canvasResources,
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