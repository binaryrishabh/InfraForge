import { chooseARetryMitigationV2 } from "./lessons/choose-a-retry-mitigation-v2";
import { dnsPublicationLessons } from "./dns-publication";
export { track } from "./track";
import { incidentEvidenceLessons } from "./incident-evidence";
import { firstFailureLessons } from "./first-failure";
import { failureReasoningLessons } from "./failure-reasoning";
export const lessons = [...firstFailureLessons, ...incidentEvidenceLessons, ...failureReasoningLessons, ...dnsPublicationLessons];

import { dnsCacheLifetime as originalDnsCacheLifetime } from "./lessons/dns-cache-lifetime";
import { leaveRoomForFirewallFlows as originalLeaveRoomForFirewallFlows } from "./lessons/leave-room-for-firewall-flows";
import { chooseARetryMitigation as originalChooseARetryMitigation } from "./lessons/choose-a-retry-mitigation";
export const archivedLessons = [chooseARetryMitigationV2, originalDnsCacheLifetime, originalLeaveRoomForFirewallFlows, originalChooseARetryMitigation];
