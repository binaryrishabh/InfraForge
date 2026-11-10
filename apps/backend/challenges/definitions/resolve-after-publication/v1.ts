import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const resolveAfterPublicationV1: ChallengeDefinition = {
  engine: "2", id: "resolve-after-publication", version: 1, title: "Resolve after publication", difficulty: "core",
  summary: "The record is published, but the caller's resolver still remembers an earlier negative answer.",
  concepts: ["Negative DNS caching", "Resolver TTL ceiling", "Connection-open resolution", "One-change experiments"],
  story: ["The caller asks for app.example before its single record exists. The authority publishes the app's existing address after second two. The app already has enough capacity.",
    "Run unchanged. Separate the initial absence, publication receipt and current authoritative record from the resolver's cached answer and failed connection opens."],
  objective: "Through second 8, complete at least 50 callers with at most 30 unsuccessful callers. Change one saved setting and compare the recorded evidence.",
  workload: {targetThroughput: 600, throughputUnit: "per-minute", trafficShape: "steady", peakMultiplier: 1, readWriteRatio: 1, payloadSize: "light"},
  workloadNote: "Ten read callers/s, steady light payloads. One name and one destination. The initially absent authority returns a modeled five-second negative answer.",
  evaluationSeconds: 8, evaluationNote: "Cumulative callers through second eight, including failures before publication. Publication occurs at simulated 2,000,001 us. No real-world DNS timing is represented.",
  criteria: [{id: "checks", kind: "deployment-checks", label: "Complete deployment checks"},
    {id: "callers", kind: "caller-outcomes", label: "Complete 50; at most 30 unsuccessful through second 8", minCompleted: 50, maxUnsuccessful: 30}],
  predictions: [{id: "health", kind: "overall-health", prompt: "What overall health will the unchanged run record in second 8?"}],
  scenario: {version: 1, visibility: "revealed", steps: [{id: "publish", atSecond: 2,
    request: {interventionId: "dns-publish-entry", revision: 1, target: {resourceId: "dns"}, parameters: {}}}]},
  hints: ["Read DNS: Initial record, DNS: Published at and DNS: Current record generation beside DNS: Negative cache hits and DNS: Unresolved connections.",
    "The authority's new record does not clear a cached NXDOMAIN. More app CPU cannot repair name resolution before app admission.",
    "Select dns. Change only Maximum cached TTL (seconds) from 60 to 1. Leave publication, app size and workload unchanged."],
  debrief: ["The resolver ceiling shortens the lifetime of answers it receives, including negative answers. After expiry a later connection open can ask again and discover the published record. Publication alone does not invalidate the negative cache.",
    "Compare caller outcomes and unresolved opens alongside publication and first successful resolution times. Authority negative responses and cached negative hits count different events; neither is the completed-caller count.",
    "For a near miss, restore the starter and change only app size from small to large. The same unresolved callers fail before app admission. Final Healthy service does not erase earlier failures.",
    "All timing is deterministic InfraForge teaching policy. This is one synthetic A record, one resolver and one destination. No recursive hierarchy, arbitrary internet DNS, DNSSEC, deletion, health routing, production propagation or availability guarantee is modeled. Cache expiry does not migrate an established connection.", MODEL_NOTE],
  starter: starter([["dns", "DNS", 0, 0, {dnsPublication: {version: 1, initialRecord: "absent"}, dnsCachePolicy: {version: 1, maxTtlSeconds: 60}}],
    ["app", "Virtual Machine", 1, 0, {size: "small"}]], [["dns", "app"]]),
};
