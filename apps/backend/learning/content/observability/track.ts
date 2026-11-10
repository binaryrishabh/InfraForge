import type { LearningTrack } from "@infraforge/contracts/learning";
import { monitoringOwnership } from "./monitoring-ownership";
import { monitoringThroughput } from "./monitoring-throughput";
import { monitoringControl } from "./monitoring-control";

export const track: LearningTrack = {id: "observability", title: "Monitoring and observability", availability: "available",
  summary: "Separate monitoring pipeline behavior from the health of the system it observes.", modules: [monitoringOwnership, monitoringThroughput, monitoringControl]};
