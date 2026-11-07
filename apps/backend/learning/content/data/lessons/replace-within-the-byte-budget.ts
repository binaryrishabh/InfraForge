import type { LearningLesson } from "@infraforge/contracts/learning";

export const replaceWithinTheByteBudget: LearningLesson = {
  id: "replace-within-the-byte-budget", contentVersion: 1, trackId: "data", moduleId: "object-ownership",
  title: "Replace an object within its byte budget", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Reason about current byte ownership, replacements and refused writes without confusing an effect with a delivery receipt.",
  prerequisites: ["leave-time-to-acknowledge", "duplicate-effects-and-ownership"], experiment: null,
  problem: ["A nearly full store receives a larger replacement for the same namespace and key. The new body would exceed capacity. What should a refusal leave behind?"],
  explanation: [
    "Treat namespace and key together as the object identity. In this model, a committed replacement takes over that identity; an older body is not kept as another stored version. Capacity admission compares the other owned bytes plus the proposed replacement body with the byte limit. Adding every attempted body would count ownership that never committed.",
    "A refused replacement leaves the current object, its generation and its bytes unchanged. A successful replacement advances the store's generation high-water mark and increments committed puts and replacements. The high-water mark includes initial objects and survives deletion; it is neither the current object count nor a per-key version history.",
    "Revisit Finish the effect, then acknowledge (leave-time-to-acknowledge). In a new saved report, compare Object replacements (cumulative), Object committed puts (cumulative) and Object stored bytes (current) with Queue: completed object effects and Queue: acknowledged. A repeated same-size effect can replace a result without increasing owned bytes. That does not acknowledge the queue receipt or prove business correctness.",
    "Puts reaching capacity check (cumulative) excludes failed conditions and cancellation before application. Object command reasons (cumulative) covers all object command kinds. Keep these populations separate: a failed condition is not a capacity refusal. Current inventory names the retained identities and generations; it cannot reconstruct an omitted identity or every earlier write attempt."
  ],
  check: {
    question: "The stated larger replacement is refused for capacity. Which object state follows from the model's ownership rule?",
    choices: [
      {id: "retain", text: "The old body, bytes and generation remain current."},
      {id: "advance", text: "The old body remains, but refusal creates a new generation."},
      {id: "reserve", text: "Both bodies consume stored capacity even though the replacement was refused."},
    ],
    correctChoiceId: "retain",
    explanation: "Capacity is checked before committing the new body or advancing generation. Refusal records a reason and preserves the current ownership. A conditional failure also preserves it, but has a different reason.",
  },
  limitations: [
    "Conceptual exercise only; no new runnable replacement or capacity experiment is supplied. Arbitrary object identities and generation conditions are not designer controls. The existing worker result policy supplies a fixed conditional-write mechanism.",
    "Saved inventory retains bounded current rows without object content. Omitted identities, earlier generations, an all-submitted-put count and absent historical measurements remain Unknown. An absent sparse capacity-refusal field is not displayed as zero.",
    "Modeled byte ownership does not establish provider storage capacity, physical durability, retained versions, or a transaction spanning object effects and queue acknowledgement.",
  ],
  followUp: "Reopen leave-time-to-acknowledge with duplicate-effects-and-ownership in mind. Name the object identity, separate repeated effects from acknowledgements, and explain why unchanged stored bytes alone cannot establish that no replacement occurred.",
};
