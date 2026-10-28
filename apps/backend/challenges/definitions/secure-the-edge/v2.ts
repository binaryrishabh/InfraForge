import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
// Model 2: calibrated with Model 2 runs of the starting and reference designs (2026-10-28).
export const secureTheEdgeV2: ChallengeDefinition = {
  engine: "2", id: "secure-the-edge", version: 2, title: "Secure the edge", difficulty: "starter",
  summary: "An inherited design works, but exposes more than it should. Close the gaps without breaking it.",
  concepts: ["Network exposure", "Encryption", "SSH access"],
  story: [
    "You have inherited a working design from a hurried launch. It serves traffic, but the security scan will not be happy.",
    "Some resources are public that should not be, one app server allows SSH from anywhere, and public endpoints are not encrypted.",
  ],
  objective: "Get a clean security scan while keeping every resource out of saturation at the evaluation second.",
  workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "400,000 requests per hour (about 111 per second), steady, 80% reads, medium payloads.",
  evaluationSeconds: 60, evaluationNote: "Checked at simulated second 60.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "security", kind: "security-clean", label: "Security scan reports no issues" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 60" },
  ],
  predictions: [
    { id: "security", kind: "security-clean", prompt: "Will the security scan report zero issues for the design you submit?" },
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 60?" },
  ],
  hints: [
    "Only the entry point should face the internet. App servers and the database can stay private.",
    "Turn on encryption for anything that stays public, and close port 22 to the world.",
    "None of these changes needs more capacity: the design already handles the traffic at about 20% CPU per app server.",
  ],
  debrief: [
    "The starting design serves its traffic comfortably, at about 20% CPU per app server, but the scan finds five exposures: an unencrypted public load balancer, public SSH, a public unencrypted app server and a public database.",
    "Making the app servers and database private, encrypting the public load balancer and closing SSH clears the scan without changing capacity. Security and performance are separate checks; a fast design can still be unsafe.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { public: true }],
    ["vm1", T.VirtualMachine, 2, 0, { public: true, openPorts: [22, 8080] }], ["vm2", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1, { public: true }],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "db")]),
};
