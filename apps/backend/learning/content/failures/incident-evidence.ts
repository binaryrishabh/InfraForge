import type { ModuleDefinition } from "@infraforge/contracts/learning";
import { findTheDenyingRule } from "./lessons/find-the-denying-rule";
import { leaveRoomForFirewallFlows } from "./lessons/leave-room-for-firewall-flows";
import { chooseARetryMitigation } from "./lessons/choose-a-retry-mitigation";

export const incidentEvidenceLessons = [findTheDenyingRule, leaveRoomForFirewallFlows, chooseARetryMitigation];
export const incidentEvidence: ModuleDefinition & {availability: "available"} = {
  id: "incident-evidence", title: "Diagnose, mitigate and verify", availability: "available",
  summary: "Read recorded causes before editing, distinguish security populations and compare a mitigation's tradeoffs.",
  lessonIds: incidentEvidenceLessons.map(lesson => lesson.id),
};
