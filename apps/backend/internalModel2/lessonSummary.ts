import type { LessonSummary } from "@infraforge/contracts/internal-lessons";
import { phases } from "@infraforge/contracts/internal-lessons";
import { readLessonPolicy } from "./lessonPolicy";
import { readEnvelope } from "./envelope";
import { readCapture } from "./capture";
import type { InternalRunRow } from "./store";
export function lessonSummary(row: InternalRunRow, policy: unknown, receipt: unknown): LessonSummary {
  const summary: LessonSummary = { profile: "Unknown", phase: "Unknown", kind: "Unknown", readOutcome: "Unknown", returnedBytes: null,
    explanation: "No compatible recorded read result is available. Missing work is not zero.",
    limits: ["Authored software scenario; physical durability, security, reliability, latency and price remain Unknown.", "Retained logical object state is an explicit teaching assumption."] };
  try {
    const p = readLessonPolicy(policy, row.inputHash); summary.profile = p.schema; summary.phase = phases[p.phase].label;
    const input = readEnvelope(row.input, row.inputHash, false), capture = readCapture(row.evidence, row.inputHash);
    if (input.schema !== "infraforge-internal-execution/1" || capture.schema !== "infraforge-internal-evidence/1") throw Error("Object lesson requires v1 evidence");
    if (capture.source !== input.source || capture.sequence !== row.sequence || capture.throughUs !== row.throughUs) throw Error("Capture metadata mismatch");
    const read = capture.model.commands.results.find((result) => result.id === "command-2");
    if (!read) return summary;
    summary.kind = "Observed"; summary.readOutcome = read.outcome;
    const reply = read.reply as { ok?: boolean; object?: { bytes?: number } } | null;
    summary.returnedBytes = typeof reply?.object?.bytes === "number" ? reply.object.bytes : null;
    summary.explanation = `Recorded read command: ${read.outcome} at ${read.at} modeled us. ${row.status === "completed" ? "The modeled horizon completed." : "This is a retained prefix; the lesson is incomplete."} Inspect the command reply and checkpoint history below.`;
    if (!receipt) summary.limits.push("Containment receipt is unavailable; isolation enforcement is Unknown.");
    return summary;
  } catch { return summary; }
}
