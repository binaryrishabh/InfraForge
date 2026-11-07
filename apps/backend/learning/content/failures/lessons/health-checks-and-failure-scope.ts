import type { LearningLesson } from "@infraforge/contracts/learning";

export const healthChecksAndFailureScope: LearningLesson = {
  id: "health-checks-and-failure-scope", contentVersion: 1, trackId: "failures", moduleId: "failure-reasoning",
  title: "Check what a health probe can change", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Distinguish detecting an unusable member from repairing a dependency shared by every member.",
  prerequisites: ["check-the-missing-server", "find-the-denying-rule", "retry-ownership-across-layers"], experiment: null,
  problem: ["Compare an unreachable app with a healthy spare against a rule denying the shared database path. Would probing more often address the same cause?"],
  explanation: [
    "Revisit Notice a missing server (check-the-missing-server). Compare Whole run: Completed and Whole run: Failed with Overall health and the action timeline's Resolved targets:. The authored crash affects app while peer has capacity. Faster detection can change which existing member receives work; it does not repair the crashed host.",
    "Now revisit Diagnose a blocked dependency (find-the-denying-rule). Inspect Denied by rule, Backend deliveries and Whole run: Failed rather than inferring reachability from database CPU or health. The denial occurs on the database path. Changing how often a balancer checks an app does not edit that firewall rule.",
    "In a thought experiment where every app uses the same denied dependency path, excluding another app cannot create a permitted path. First identify what the probe observes, what routing decision it can change and whether an eligible alternative can serve the operation. A probe that passes locally need not test every downstream dependency.",
    "Use each lab for the cause it isolates. The crash lab compares health-check intervals; the firewall lab compares rule policy. They do not form a controlled test of faster probes during a firewall denial. A final Healthy sample cannot recover failed callers or establish continuous health."
  ],
  check: {question: "Every app needs the same database path, denied by an unchanged firewall rule. What does a shorter probe interval establish by itself?",
    choices: [{id: "permission", text: "The database path becomes permitted."}, {id: "repair", text: "The firewall rule is repaired by repeated checks."}, {id: "scope", text: "No permission change; detection frequency does not edit the denying rule."}],
    correctChoiceId: "scope", explanation: "The control changes detection frequency. The stated failure needs a permitted dependency path; routing among apps using the same denied path does not supply one."},
  limitations: ["Conceptual comparison across distinct labs, not an executed health-check intervention on the firewall lab. Probe semantics must be checked for the actual operation and path.",
    "The crash has an authored restart. Neither the action timeline nor terminal health proves host repair, exact recovery time, continuous health or production availability."],
  followUp: "Return to check-the-missing-server and find-the-denying-rule. For each, name the failed path, the setting that can affect it and the saved measurement needed to challenge your diagnosis.",
};
