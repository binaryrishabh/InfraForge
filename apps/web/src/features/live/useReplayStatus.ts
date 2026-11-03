import { useEffect, useState } from "react";
import type { ReplayQueueStatus } from "@infraforge/contracts/deployment";
import { http, API_URL } from "@/client/httpClient";

/* Reads the server's replay queue state for a run this tab has submitted. It asks every few seconds while the run is
waiting, and shows nothing when the server does not report a queue (an older server, or the run is no longer replaying). */
export function useReplayStatus(deploymentId: string, active: boolean, everyMs = 5000) {
  const [replay, setReplay] = useState<ReplayQueueStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const read = () => { void http.get(`${API_URL}/deployments/${deploymentId}`).then((response) => { if (!stopped) setReplay(response.data.replay ?? null); }).catch(() => {}); };
    read();
    const timer = setInterval(read, everyMs);
    return () => { stopped = true; clearInterval(timer); };
  }, [deploymentId, active, everyMs]);
  return active ? replay : null;
}
