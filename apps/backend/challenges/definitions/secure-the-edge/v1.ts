import { RESOURCE_TYPES as T } from "@infraforge/domain/resource";
import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { fanIn, fanOut, starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

// Published. Immutable: any change, even to wording, ships as the next version file.
export const secureTheEdgeV1: ChallengeDefinition = {
  id: "secure-the-edge", version: 1, title: "Secure the edge", difficulty: "starter",
  summary: "An inherited design works, but exposes more than it should. Close the gaps without breaking it.",
  concepts: ["Network exposure", "Encryption", "SSH access"],
  story: [
    "You have inherited a working design from a hurried launch. It serves traffic, but the security scan will not be happy.",
    "Some resources are public that should not be, one app server allows SSH from anywhere, and public endpoints are not encrypted.",
  ],
  objective: "Get a clean security scan while keeping every resource out of saturation at the evaluation second.",
  workload: { targetThroughput: 400_000, throughputUnit: "per-hour", trafficShape: "steady", peakMultiplier: 3, readWriteRatio: 0.8, payloadSize: "medium" },
  workloadNote: "400,000 requests per hour, steady, 80% reads, medium payloads.",
  evaluationSeconds: 90, evaluationNote: "Checked at simulated second 90.",
  criteria: [
    { id: "checks", kind: "deployment-checks", label: "Passes the deployment checks" },
    { id: "security", kind: "security-clean", label: "Security scan reports no issues" },
    { id: "capacity", kind: "no-saturation", label: "No resource saturated or failed at second 90" },
  ],
  predictions: [
    { id: "security", kind: "security-clean", prompt: "Will the security scan report zero issues for the design you submit?" },
    { id: "health", kind: "overall-health", prompt: "What will overall health be at second 90?" },
  ],
  hints: [
    "Select each resource and open its exposure settings in the inspector. The scan looks at public access, encryption and open ports.",
    "Only the entry point needs to be public. The scan flags any public resource without encryption, any public resource with port 22 open, and any public database.",
    "Keep the load balancer public but encrypted. Make the app servers and the database private.",
  ],
  debrief: [
    "The scan applies three rules to each resource: a database must not be public, a public resource must not expose port 22, and a public resource must be encrypted. The starter broke all three, five times in total.",
    "Exposure settings do not change capacity in this model. Making resources private removes findings without changing CPU or health, so the original two app servers still carry the load.",
    MODEL_NOTE,
  ],
  starter: starter([
    ["dns", T.DNS, 0, 1], ["lb", T.LoadBalancer, 1, 1, { public: true }],
    ["vm1", T.VirtualMachine, 2, 0, { public: true, openPorts: [22, 8080] }], ["vm2", T.VirtualMachine, 2, 2],
    ["db", T.Database, 3, 1, { public: true }],
  ], [["dns", "lb"], ...fanOut("lb", ["vm1", "vm2"]), ...fanIn(["vm1", "vm2"], "db")]),
};
