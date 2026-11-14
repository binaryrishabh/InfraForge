import type { LearningModule } from "@infraforge/contracts/learning";
import { firewallRuleMatching } from "./lessons/firewall-rule-matching";
import { dnsCacheLifetime } from "./lessons/dns-cache-lifetime-v2";
import { missingFailureObservations } from "./lessons/missing-failure-observations";
import { mitigationTradeoffs } from "./lessons/mitigation-tradeoffs";
import { findTheDenyingRuleV2 as findTheDenyingRule } from "./lessons/find-the-denying-rule-v2";
import { leaveRoomForFirewallFlowsV2 as leaveRoomForFirewallFlows } from "./lessons/leave-room-for-firewall-flows-v2";
import { chooseARetryMitigationV3 as chooseARetryMitigation } from "./lessons/choose-a-retry-mitigation-v3";

export const incidentEvidenceLessons = [firewallRuleMatching, dnsCacheLifetime, missingFailureObservations, mitigationTradeoffs,
  findTheDenyingRule, leaveRoomForFirewallFlows, chooseARetryMitigation];
export const incidentEvidence: LearningModule & {availability: "available"} = {
  id: "incident-evidence", title: "Diagnose, mitigate and verify", availability: "available",
  summary: "Read recorded causes before editing, distinguish security populations and compare a mitigation's tradeoffs.",
  lessonIds: incidentEvidenceLessons.map(lesson => lesson.id),
};
