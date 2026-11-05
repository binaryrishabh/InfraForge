import type { LearningLesson } from "@infraforge/contracts/learning";

export const firewallRuleMatching: LearningLesson = {
  "id": "firewall-rule-matching",
  "contentVersion": 1,
  "trackId": "failures",
  "moduleId": "incident-evidence",
  "title": "What a firewall rule matches",
  "summary": "Distinguish policy matching, listener admission and connection-state capacity.",
  "kind": "reading",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "request-journey"
  ],
  "experiment": null,
  "problem": [
    "A database has idle CPU, but its app cannot reach it through a firewall. Does more database CPU change the admission decision?"
  ],
  "explanation": [
    "A firewall policy compares traffic with rule fields such as direction, protocol, port and peer. The matching rule's action determines whether that traffic is admitted under the policy. Rule priority matters when more than one rule could apply.",
    "An allowed policy decision is only one part of reachability. The destination still needs an admitted listener, and a stateful firewall can have a separate limit on tracked connections. Policy denial, missing listener and full connection state are different causes.",
    "Trace the specific source-to-destination path before choosing a rule. A broad permission can change exposure without fixing the intended path. Low destination CPU alone does not identify which admission stage refused traffic."
  ],
  "check": {
    "question": "Which change directly addresses a rule that denies the intended database port?",
    "choices": [
      {
        "id": "cpu",
        "text": "Add database CPU."
      },
      {
        "id": "policy",
        "text": "Correct the relevant matching rule and its priority."
      },
      {
        "id": "state",
        "text": "Increase tracked connection capacity without changing policy."
      }
    ],
    "correctChoiceId": "policy",
    "explanation": "A policy denial is a matching decision. CPU or state capacity alone does not alter the denying rule."
  },
  "limitations": [
    "This is a policy model, not a packet trace or production security assessment. Existing flows and default actions depend on the system; consult the lab's stated model."
  ],
  "followUp": "List the path, port and rule you would inspect, then distinguish policy denial from a full connection table."
};
