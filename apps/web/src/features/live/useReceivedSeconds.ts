import { useEffect, useState } from "react";
import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import type { Health, SystemHealth } from "@/features/timetable/model";
import type { ReceivedSecond } from "@/features/timetable/fromSnapshots";

const KEEP = 900;

/* Every live snapshot this page receives, keyed by its completed second. Nothing is
filled in between snapshots, and a reconnect simply resumes from the next one. */
export function useReceivedSeconds(deploymentId: string) {
  // Kept with the run it belongs to, so switching runs never shows the previous run's seconds.
  const [state, setState] = useState<{ run: string; received: ReceivedSecond[] }>({ run: deploymentId, received: [] });
  useEffect(() => {
    let last = -1;
    return useSimulationStore.subscribe((sim) => {
      if (sim.deploymentId !== deploymentId || !sim.health || sim.simulatedSeconds === last) return;
      const metrics = Object.entries(sim.metrics);
      if (!metrics.length) return;
      last = sim.simulatedSeconds;
      const second: ReceivedSecond = {
        t: sim.simulatedSeconds, system: sim.health as SystemHealth,
        resources: Object.fromEntries(metrics.map(([id, m]) => [id, { health: m.health as Health, cpu: m.cpu }])),
      };
      setState((prev) => ({ run: deploymentId, received: [...(prev.run === deploymentId ? prev.received : []).filter((p) => p.t < second.t), second].slice(-KEEP) }));
    });
  }, [deploymentId]);
  return state.run === deploymentId ? state.received : [];
}
