import type { LearningLesson } from "@infraforge/contracts/learning";

export const leaveRoomForFirewallFlows: LearningLesson = {
  id: "leave-room-for-firewall-flows", contentVersion: 1, trackId: "failures", moduleId: "incident-evidence",
  title: "Separate policy from connection capacity", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Compare firewall refusals, tracked state and caller success without combining their populations.", prerequisites: ["find-the-denying-rule", "firewall-rule-matching"],
  problem: ["An allow-all firewall can still refuse new connections when tracked state is full. Some refused startup probes can coexist with successful callers through other paths."],
  explanation: ["Run unchanged. Read fw occupancy, tracked admissions, policy denials, capacity refusals and expired entries in the saved report. Compare them with whole-run caller outcomes.",
    "On fw change only Tracked connection limit from 1 to 8. Keep the one-second idle timeout and app count unchanged. Compare both reports at second 6.",
    "Try a larger app catalog size with the original one-flow limit. Explain why app CPU capacity does not change the firewall limit. Describe which population improves and which stays the same."],
  experiment: {challengeId: "leave-room-for-firewall-flows", prediction: "Can the final modeled health be Healthy while the cumulative firewall counter records refused connections?",
    evidenceToInspect: ["Tracked state admissions; Current flow occupancy; Configured flow limit; Expired flow entries", "Policy denied new admissions; Flow capacity refusals", "Whole run: Completed; Whole run: Failed; Health"]},
  limitations: ["Results are educational model outputs. The budget includes startup probes and counts connections rather than unique callers. Removing these refusals does not prove an availability improvement; callers succeed in both calibrated runs.",
    "Established flows bypass new admission checks until close or modeled idle expiry. No packet-level state machine, provider limit or firewall CPU benchmark is represented.",
    "Admissions accumulate, occupancy is current, and expiry is a separate counter. Missing historical security counters remain Unknown, never zero."],
  followUp: "Explain why tracked admissions can exceed current occupancy and why a clean exposure scan does not prove enough connection-state capacity.",
  check: {question: "What does a larger saved firewall flow limit directly change?", choices: [{id: "state", text: "How many connections can hold tracked state"}, {id: "cpu", text: "The app's CPU work per request"}],
    correctChoiceId: "state", explanation: "The flow limit governs firewall state admission. It does not change application work."},
};
