import type { LearningLesson } from "@infraforge/contracts/learning";

export const mitigationTradeoffs: LearningLesson = {
  "id": "mitigation-tradeoffs",
  "contentVersion": 1,
  "trackId": "failures",
  "moduleId": "incident-evidence",
  "title": "Choose a mitigation with a tradeoff",
  "summary": "Choose one bounded change and check both its intended benefit and its cost.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "missing-failure-observations",
    "retries-add-work"
  ],
  "experiment": null,
  "problem": [
    "Fewer retries might reduce pressure after a dependency failure. What would you need to inspect before calling that a better mitigation?"
  ],
  "explanation": [
    "A mitigation aims to reduce harm under particular conditions. Start with the observed constraint and state the mechanism the change should affect. A plausible setting is a hypothesis until relevant observations support it.",
    "Choose one change with a way to reverse it. Keep workload and fault conditions comparable, then inspect both the intended benefit and an adverse outcome. Reducing retries can reduce repeated attempts while leaving some original callers unsuccessful.",
    "Choose using the requirement you need to protect and the tradeoff you can accept. A better percentile among completions does not establish more successful callers. If important outcomes were not measured, keep the decision conditional and name the next observation."
  ],
  "check": {
    "question": "Which comparison best supports a retry mitigation decision?",
    "choices": [
      {
        "id": "label",
        "text": "Only a later Healthy label."
      },
      {
        "id": "tradeoff",
        "text": "Repeated attempts and latency alongside failed, completed and unfinished callers under comparable conditions."
      },
      {
        "id": "many",
        "text": "Several settings and a different workload changed together."
      }
    ],
    "correctChoiceId": "tradeoff",
    "explanation": "The intended pressure reduction and the caller cost both matter. Comparable conditions help connect them to the chosen change."
  },
  "limitations": [
    "This is a conceptual decision exercise, not operational advice for a live incident. It verifies no production recovery, availability or safe retry behavior for application writes."
  ],
  "followUp": "Propose one retry change, its reversal, a benefit to inspect and a caller outcome that could make you reject it."
};

