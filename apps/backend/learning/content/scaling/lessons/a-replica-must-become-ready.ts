import type { LearningLesson } from "@infraforge/contracts/learning";

export const aReplicaMustBecomeReady: LearningLesson = {
  id: "a-replica-must-become-ready", contentVersion: 1, trackId: "scaling", moduleId: "startup-readiness",
  title: "A replica must become ready", kind: "conceptual-exercise", level: "intermediate", availability: "available",
  summary: "Explain why a desired replica can exist before it can serve useful work.",
  prerequisites: ["one-bigger-or-two-smaller"], experiment: null,
  problem: ["A controller wants more replicas. An image client reports artifacts ready, but the new process has not opened its listener. A teammate counts that replica as useful capacity. What is still missing?"],
  explanation: [
    "Desired count is a request for capacity. A new replica needs an identity, provisioning, its image and process startup. The image reference names what to resolve; the resolved digest and required layer identities describe what the client acquired. An unavailable manifest or layer can block startup while an already deployed replica keeps working.",
    "Artifact-ready means the required image layers are available to that client. It does not complete process startup. Listener-ready follows the controller's startup work. The load balancer has its own health observations; an open listener alone does not prove that it has selected the replica or will keep finding it healthy.",
    "In a new saved report, distinguish Artifact-ready time (us) from Listener-ready time (us). Match the artifact target to the controller replica identity. Compare Desired replicas (current), LB-eligible replicas (current) and Replica LB healthy (current). A timestamp describes a transition; a health flag describes the sample. Neither supplies a continuous health history.",
    "Artifact pulled bytes (cumulative), Artifact reused layers (cumulative) and Artifact failures (cumulative) belong to the client. A cache match can avoid a blob pull, but does not skip process startup. Registry response bytes include generated manifest and blob bodies; they are not a delivered-byte total. Initially deployed replicas may already be listener-ready without an observed image pull."
  ],
  check: {question: "Artifacts are ready, but the process listener is still closed. What can you conclude?",
    choices: [{id: "acquired", text: "The client acquired its layers; process startup and LB eligibility still need separate observations."},
      {id: "serving", text: "The replica is already useful because desired count includes it."},
      {id: "healthy", text: "The artifact timestamp establishes continuous LB health."}],
    correctChoiceId: "acquired", explanation: "Acquiring layers completes an artifact step. The controller opens the listener after startup, and the load balancer observes health separately. Desired count does not prove either transition."},
  limitations: [
    "Conceptual exercise only; no scored startup lab, calibrated workload or designer-controlled image size, layer cache or process startup duration is supplied. Replica limits and CPU targets are existing controls, but changing them does not isolate artifact speed.",
    "Reports retain bounded current identities and events. Missing historical fields, omitted identities, replica generation and exact first LB-eligible time remain Unknown. A slot ordinal is not a generation.",
    "Authored digest identities and educational startup work do not establish actual byte hashing, full OCI behavior, provider pull speed, useful throughput or production availability."
  ],
  followUp: "Before proposing more replicas, name the gate each observation settles and the caller outcome still needed to establish useful capacity. A later scaling window needs its own controlled comparison.",
};
