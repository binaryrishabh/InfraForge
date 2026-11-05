import type { LearningLesson } from "@infraforge/contracts/learning";

export const loadBalancerPolicies: LearningLesson = {
  "id": "load-balancer-policies",
  "contentVersion": 1,
  "trackId": "scaling",
  "moduleId": "serving-under-load",
  "title": "What a load balancer policy decides",
  "summary": "Separate choosing a backend from adding capacity or proving health.",
  "kind": "reading",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "request-routing"
  ],
  "experiment": null,
  "problem": [
    "Two app servers accept the same kind of request, but one stays busy longer. Should taking equal turns also mean equal waiting?"
  ],
  "explanation": [
    "A load balancer policy chooses an eligible backend for a request. Round robin takes turns; least outstanding prefers the backend with fewer unfinished requests. Neither choice creates workers or CPU on the selected server.",
    "Eligibility and selection answer different questions. A health check can exclude a backend, while a selection policy chooses among those still eligible. Passing a health check does not promise short waits for every caller.",
    "Before choosing a policy, ask what it observes. A count of unfinished requests is a useful signal, but it is not a direct measurement of the work remaining in each request."
  ],
  "check": {
    "question": "Which change directly changes where the next eligible request is sent?",
    "choices": [
      {
        "id": "capacity",
        "text": "Give both servers more CPU."
      },
      {
        "id": "selection",
        "text": "Change the backend selection policy."
      },
      {
        "id": "queue",
        "text": "Increase waiting room on each server."
      }
    ],
    "correctChoiceId": "selection",
    "explanation": "Selection chooses a destination. CPU and queue capacity affect what a destination can handle after selection."
  },
  "limitations": [
    "This reading compares policy ideas. It establishes no measured latency improvement or production routing guarantee."
  ],
  "followUp": "Sketch two backends with different unfinished-request counts. Explain which each policy would choose and what it cannot know."
};

