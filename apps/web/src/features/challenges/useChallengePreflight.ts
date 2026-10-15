import { useEffect, useState } from "react";
import type { ChallengePreflight } from "@infraforge/contracts/challenges";
import { challengePreflight } from "@/api/challenges.api";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";

/* Debounced server readiness for the canvas as it is now (including unsaved edits).
It uses the same gate code the worker runs; it reports, it never decides a result. */
export function useChallengePreflight(challengeId: string | null, version?: number) {
  const resources = useCanvasStore((s) => s.resources);
  const connectionLines = useCanvasStore((s) => s.connectionLines);
  const [state, setState] = useState<{ key: string; data: ChallengePreflight | null; error: boolean }>({ key: "", data: null, error: false });
  useEffect(() => {
    if (!challengeId) return;
    let active = true;
    const timer = setTimeout(() => {
      challengePreflight(challengeId, { resources, connectionLines }, version)
        .then((data) => { if (active) setState({ key: challengeId, data, error: false }); })
        .catch(() => { if (active) setState((prev) => ({ ...prev, key: challengeId, error: true })); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [challengeId, resources, connectionLines, version]);
  return state.key === challengeId ? state : { key: "", data: null, error: false };
}
