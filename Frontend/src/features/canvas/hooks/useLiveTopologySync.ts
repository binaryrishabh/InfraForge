import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { syncDeploymentTopology } from "@/api/deployment.api";

const SYNC_DEBOUNCE_MS = 400;

/* While a deployment is LIVE, any committed mutation to resources or
   connectionLines is debounced (~400ms) then pushed to the simulator via
   sync-topology. Uses store.subscribe (zero-render) so this hook never
   re-renders its host. Errors toast once per burst, reset on success. */
export function useLiveTopologySync(isLive: boolean) {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorToastShownRef = useRef(false);

  useEffect(() => {
    if (!isLive) return;

    const scheduleSync = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(async () => {
        const store = useCanvasStore.getState();
        const deploymentId = store.activeDeploymentId;
        if (!deploymentId) return;
        try {
          await syncDeploymentTopology(
            deploymentId,
            store.resources,
            store.connectionLines,
          );
          errorToastShownRef.current = false;
        } catch {
          if (!errorToastShownRef.current) {
            errorToastShownRef.current = true;
            toast.error("Failed to sync topology to the live simulation");
          }
        }
      }, SYNC_DEBOUNCE_MS);
    };

    const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
      const resourcesChanged = state.resources !== prevState.resources;
      const connectionsChanged = state.connectionLines !== prevState.connectionLines;
      if (resourcesChanged || connectionsChanged) {
        scheduleSync();
      }
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [isLive]);
}