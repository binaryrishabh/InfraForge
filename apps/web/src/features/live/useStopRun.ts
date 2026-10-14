import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { RunAction } from "@infraforge/contracts/actions";
import { getRunAction, teardownDeployment } from "@/api/deployment.api";
import { errorMessage } from "@/api/errorMessage";

const OPEN = ["requested", "applying", "running"];

/* A stop is a durable action: it is requested, then the simulator captures the
exact final state. Completion is confirmed by polling the action, never assumed. */
export function useStopRun(deploymentId: string) {
  const [action, setAction] = useState<RunAction | null>(null);
  const [requesting, setRequesting] = useState(false);
  const stopping = !!action && OPEN.includes(action.status);
  const actionId = action?.id;
  useEffect(() => {
    if (!stopping || !actionId) return;
    let active = true, busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void getRunAction(deploymentId, actionId).then((next) => { if (active) setAction(next); })
        .catch(() => { /* a lost connection cannot establish completion */ }).finally(() => { busy = false; });
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [deploymentId, stopping, actionId]);
  const stop = async () => {
    setRequesting(true);
    try {
      const next = await teardownDeployment(deploymentId);
      setAction(next);
      toast.info(next.status === "completed" ? "Run stopped" : "Stop requested. Waiting for the simulator to capture the final state.");
      return true;
    } catch (error) { toast.error(errorMessage(error, "The stop could not be requested.")); return false; }
    finally { setRequesting(false); }
  };
  return { stop, requesting, stopping, stopped: action?.status === "completed" };
}
