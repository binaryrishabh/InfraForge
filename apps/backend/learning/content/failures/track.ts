import type { TrackDefinition } from "@infraforge/contracts/learning";
import { incidentEvidence } from "./incident-evidence";

export const track: TrackDefinition & {availability: "available"} = {
  id: "failures", title: "Security, failures and recovery", availability: "available",
  summary: "Diagnose denied dependencies, inspect firewall state and compare mitigation evidence after a partition.", modules: [incidentEvidence],
};
