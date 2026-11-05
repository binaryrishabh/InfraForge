import type { LearningLesson } from "@infraforge/contracts/learning";

export const missingFailureObservations: LearningLesson = {
  "id": "missing-failure-observations",
  "contentVersion": 1,
  "trackId": "failures",
  "moduleId": "incident-evidence",
  "title": "Name what failure evidence is missing",
  "summary": "Keep a symptom, a suspected cause and an unobserved fact separate.",
  "kind": "conceptual-exercise",
  "level": "intermediate",
  "availability": "available",
  "prerequisites": [
    "first-bottleneck"
  ],
  "experiment": null,
  "problem": [
    "Callers fail and a database looks idle. There is no admission counter for the connecting path. Can you conclude the firewall denied it?"
  ],
  "explanation": [
    "A symptom narrows an investigation but need not identify a cause. Idle database CPU could mean requests were refused before arrival, no work was offered, or another dependency held them up.",
    "State a hypothesis and the observation needed to distinguish it. For an admission hypothesis, look for the relevant path, rule or listener counters. If those observations were not retained, the cause remains Unknown rather than becoming a zero count.",
    "Match each observation to its interval and population. A final Healthy sample does not describe continuous health; the end of an intervention does not measure how long callers took to recover. A clean exposure scan answers a different question from runtime reachability."
  ],
  "check": {
    "question": "What is the honest conclusion when the needed path counter was not recorded?",
    "choices": [
      {
        "id": "unknown",
        "text": "The admission cause remains Unknown; name the missing observation."
      },
      {
        "id": "zero",
        "text": "There were zero denials."
      },
      {
        "id": "certain",
        "text": "Idle CPU proves the firewall denied every caller."
      }
    ],
    "correctChoiceId": "unknown",
    "explanation": "Missing observations cannot support a zero or a specific cause. State the limit and investigate the measurement that would distinguish explanations."
  },
  "limitations": [
    "This exercise supplies no incident diagnosis. Even a matching admission counter describes modeled decisions and may include probes rather than only application callers."
  ],
  "followUp": "Write a hypothesis, the observation that could refute it and one missing fact that prevents a recovery-time claim."
};

