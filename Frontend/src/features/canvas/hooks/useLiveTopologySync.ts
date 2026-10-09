import { useEffect } from "react";
import { toast } from "sonner";
import { useCanvasStore } from "../store/canvasStore";
import { syncDeploymentTopology } from "@/api/deployment.api";

const SYNC_DEBOUNCE_MS = 400;

export function useLiveTopologySync(isLive: boolean, deploymentId: string) {
  useEffect(() => {
    if (!isLive) return;
    let disposed = false;
    let sending = false;
    let blocked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, SYNC_DEBOUNCE_MS);
    };
    const flush = async () => {
      const store = useCanvasStore.getState();
      if (disposed || blocked || sending || store.activeDeploymentId !== deploymentId ||
          !store.liveTopologyDirty || store.topologyRevision === null) return;
      sending = true;
      const topology = { resources: store.resources, connectionLines: store.connectionLines };
      try {
        const revision = await syncDeploymentTopology(deploymentId, topology.resources, topology.connectionLines, store.topologyRevision);
        if (!disposed) useCanvasStore.getState().acknowledgeLiveTopology(deploymentId, topology, revision);
      } catch {
        // An unknown response may already have committed. Never rebase/retry
        // this stale canvas automatically over somebody else's newer state.
        blocked = true;
        if (!disposed) toast.error("Live edit could not be confirmed. Re-enter the environment before editing again.");
      } finally {
        sending = false;
        if (!disposed && !blocked && useCanvasStore.getState().liveTopologyDirty) schedule();
      }
    };
    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
      if (state.liveTopologyDirty && (state.resources !== previous.resources || state.connectionLines !== previous.connectionLines)) schedule();
    });
    if (useCanvasStore.getState().liveTopologyDirty) schedule();
    return () => { disposed = true; clearTimeout(timer); unsubscribe(); };
  }, [isLive, deploymentId]);
}
