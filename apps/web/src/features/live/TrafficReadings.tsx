import { useSimulationStore } from "@/features/monitoring/store/simulationStore";
import { TrafficEvidence } from "./TrafficEvidence";

export function TrafficReadings() {
  const traffic = useSimulationStore(s => s.traffic);
  return <TrafficEvidence traffic={traffic} />;
}
