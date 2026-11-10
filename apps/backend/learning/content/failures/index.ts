import { dnsPublicationLessons } from "./dns-publication";
export { track } from "./track";
import { incidentEvidenceLessons } from "./incident-evidence";
import { firstFailureLessons } from "./first-failure";
import { failureReasoningLessons } from "./failure-reasoning";
export const lessons = [...firstFailureLessons, ...incidentEvidenceLessons, ...failureReasoningLessons, ...dnsPublicationLessons];

import { dnsCacheLifetime as originalDnsCacheLifetime } from "./lessons/dns-cache-lifetime";
export const archivedLessons = [originalDnsCacheLifetime];
