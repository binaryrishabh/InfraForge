import type { LearningLesson } from "@infraforge/contracts/learning";

export const dnsCacheLifetime: LearningLesson = {
  "id": "dns-cache-lifetime",
  "contentVersion": 2,
  "trackId": "failures",
  "moduleId": "incident-evidence",
  "title": "What a DNS cache keeps",
  "summary": "Separate a cached name answer from application reachability and recovery.",
  "kind": "conceptual-exercise",
  "level": "beginner",
  "availability": "available",
  "prerequisites": [
    "dns-resolution"
  ],
  "experiment": null,
  "problem": [
    "A DNS answer for a service is cached. The service then stops responding at that address. Does the cached answer establish that the application works?"
  ],
  "explanation": [
    "A DNS cache keeps a name-lookup answer for reuse during its allowed lifetime. The TTL limits reuse; it does not measure application health. A changed authority record does not immediately replace every cached answer.",
    "For a saved run with DNS, inspect DNS: Resolver queries, DNS: Cache hits, DNS: Cache misses and DNS: Authoritative lookups. These are cumulative counts through DNS: Through time. A reusable negative answer can also be a cache hit.",
    "DNS: Cached answer generation and DNS: Cached answer expiry describe an answer still cached at capture. Expiry is absolute simulated time from run start. DNS: Cache expirations counts removed expired entries; it does not give a transition timeline. An expired answer need not trigger another query while a connection is reused.",
    "Compare the cached name, authority and address with application outcomes separately. A successful lookup does not prove that the destination is reachable or healthy. Missing generations, absent answers and omitted evidence remain Unknown."
  ],
  "check": {
    "question": "What does a still-reusable cached DNS answer establish?",
    "choices": [
      {
        "id": "health",
        "text": "The application is healthy throughout its lifetime."
      },
      {
        "id": "replace",
        "text": "Every client has already adopted a changed answer."
      },
      {
        "id": "answer",
        "text": "A prior name-lookup answer can be reused under the cache rules."
      }
    ],
    "correctChoiceId": "answer",
    "explanation": "DNS caching reuses a name answer. It does not continuously test the application or instantly propagate a changed answer."
  },
  "limitations": [
    "This remains a conceptual exercise: no DNS record-change intervention is exposed to learners or challenge scenarios, so there is no DNS recovery lab.",
    "Saved resolver counts and bounded current cache rows do not retain a timestamped transition history or prove failover timing, continuous health or application recovery.",
    "A negative answer has no recorded generation or addresses. Missing or omitted evidence is Unknown. DNS delegation, CNAME, AAAA and DNSSEC are outside this model."
  ],
  "followUp": "Separate what a cached answer shows from an application outcome. Explain why an expiry count alone cannot establish recovery."
};
