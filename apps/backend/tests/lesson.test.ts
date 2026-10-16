import { expect, test } from "bun:test";
import { restartLesson } from "@infraforge/contracts/internal-lessons/profile";
import { authoredContract, assessDesign } from "../internalModel2/authoring";
import { lessonLayout } from "../internalModel2/lessonAuthoring";
import { compileEnvelope, captureCuts, admissionSchema } from "../internalModel2/envelope";
import { capture, instantiate } from "../internalModel2/capture";
import type { StoredCapture } from "../internalModel2/capture";
import { makeLessonPolicy, readLessonPolicy, lessonSubmission } from "../internalModel2/lessonPolicy";
import { lessonSummary } from "../internalModel2/lessonSummary";
import { replayStored } from "../internalModel2/report";
import { lessonImage } from "../internalModel2/lessonLimits";
import { createArguments, verifyContainer } from "../internalModel2/sandboxDocker";
import type { InternalRunRow } from "../internalModel2/store";
for (const phase of ["before", "during", "after"] as const) test(`lesson ${phase} uses recorded commands and exact replay`, () => {
  const design = assessDesign({ id: "00000000-0000-4000-8000-000000000001", name: "Lesson", updatedAt: new Date("2026-10-16Z"), layout: lessonLayout, challengeId: null });
  expect(design.supported).toBe(true);
  const authored = authoredContract(restartLesson(phase), design); authored.contract.version = "object-restart/1";
  const request = admissionSchema.parse({ infrastructureId: design.id, expectedDesignUpdatedAt: design.updatedAt, idempotencyKey: phase, workload: authored.workload, contract: authored.contract });
  const input = compileEnvelope("00000000-0000-4000-8000-000000000002", "lesson-owner", lessonLayout, new Date(design.updatedAt), request), runtime = instantiate(input);
  let evidence: StoredCapture | undefined;
  for (const at of captureCuts(input)) { runtime.advanceTo(at); evidence = capture(runtime, input, (evidence?.sequence ?? 0) + 1, evidence?.checkpoints); }
  const row: InternalRunRow = { id: input.runId, ownerId: input.ownerId, infrastructureId: design.id, idempotencyKey: phase, requestHash: "0".repeat(64), input, inputHash: input.fingerprint, status: "completed", token: "unit", sequence: evidence!.sequence, throughUs: evidence!.throughUs, evidence, cancelRequested: false, reason: null, createdAt: new Date(), updatedAt: new Date() };
  const policy = makeLessonPolicy(input.fingerprint, phase, `sha256:${"1".repeat(64)}`, "2".repeat(64)), summary = lessonSummary(row, policy, {});
  expect(summary.kind).toBe("Observed"); expect(summary.readOutcome).toBe(phase === "during" ? "rejected" : "completed"); expect(summary.returnedBytes).toBe(phase === "during" ? null : 24);
  expect(replayStored(row)).toMatchObject({ kind: "MatchesRecordedPrefix", complete: true });
  expect(lessonSummary({ ...row, evidence: null }, policy, {}).kind).toBe("Unknown");
  expect(lessonSummary({ ...row, sequence: row.sequence - 1 }, policy, {}).kind).toBe("Unknown");
  expect(readLessonPolicy(policy, input.fingerprint)).toEqual(policy);
  expect(() => readLessonPolicy({ ...policy, phase: "after" === phase ? "before" : "after" }, input.fingerprint)).toThrow();
});
test("lesson submission and installed image are strict, with no user-supplied resource controls", () => {
  expect(lessonSubmission.safeParse({ schema: "object-restart/1", phase: "after", image: "arbitrary" }).success).toBe(false);
  expect(lessonImage({})).toBeNull(); expect(() => lessonImage({ MODEL2_LESSON_IMAGE: "latest" })).toThrow();
  const args = createArguments("infraforge-model2-unit", `sha256:${"a".repeat(64)}`);
  expect(args).toContain("--network=none"); expect(args).toContain("--memory-swap=536870912"); expect(args).toContain("--ulimit=cpu=5:5"); expect(args).not.toContain("--privileged");
  expect(() => verifyContainer({}, "unit", `sha256:${"a".repeat(64)}`)).toThrow();
});
