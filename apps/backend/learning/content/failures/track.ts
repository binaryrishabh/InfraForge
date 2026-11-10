import { dnsPublication } from "./dns-publication";
import type { LearningTrack } from "@infraforge/contracts/learning";
import { incidentEvidence } from "./incident-evidence";
import { firstFailure } from "./first-failure";
import { failureReasoning } from "./failure-reasoning";

export const track: LearningTrack & {availability: "available"} = {
  id: "failures", title: "Security, failures and recovery", availability: "available",
  summary: "Diagnose denied dependencies, inspect firewall state and compare mitigation evidence after a partition.", modules: [firstFailure, incidentEvidence, failureReasoning, dnsPublication],
};
