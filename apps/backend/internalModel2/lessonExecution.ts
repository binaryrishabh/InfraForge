import { randomUUID } from "node:crypto";
import type { WorkerOwnership } from "../infra/workerOwnership";
import { internalDatabase } from "./store";
import type { InternalRunRow } from "./store";
import { captureCuts, readEnvelope } from "./envelope";
import { readCapture } from "./capture";
import type { StoredCapture } from "./capture";
import { contentHash } from "./identity";
import { scopedLesson, withLessonRunner } from "./lessonStore";
import { lessonImage } from "./lessonLimits";
import { runSandbox } from "./sandboxRunner";
import { removeContainer, containerName, docker, inspectContainer } from "./sandboxDocker";
export async function executeLesson(id: string, ownership: WorkerOwnership) {
  const claimed = await ownership.transaction(async (db) => {
    const row = (await db.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || !["queued", "running"].includes(row.status)) return null;
    try {
      if (row.status === "running") throw Error("Prior lesson delivery stopped; exact continuation is unsupported");
      if (!(await db.query('SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$1', [row.ownerId])).rowCount) throw Error("Lesson authorization revoked");
      const record = await scopedLesson(id, row.inputHash), input = readEnvelope(row.input, row.inputHash);
      if (!record || input.runId !== id || input.ownerId !== row.ownerId || record.policy.image !== lessonImage()) throw Error("Reviewed isolation policy is unavailable or incompatible; review a new run");
      const token = randomUUID();
      await db.query('UPDATE "InternalModel2Run" SET status=\'running\',token=$2,"updatedAt"=now() WHERE id=$1', [id, token]);
      return { row, input, policy: record.policy, token };
    } catch (error) {
      await db.query('UPDATE "InternalModel2Run" SET status=$2,reason=$3,"updatedAt"=now() WHERE id=$1', [id, row.status === "running" ? "interrupted" : "failed", reason(error)]); return null;
    }
  });
  if (!claimed) return;
  let previous: StoredCapture | undefined, continuing = true;
  const receipt = async (value: unknown) => ownership.transaction(async (db) => {
    await db.query(`UPDATE "InternalModel2LessonRun" l SET receipt=$3 FROM "InternalModel2Run" r WHERE l."runId"=$1 AND r.id=l."runId" AND r.token=$2 AND r.status='running'`, [id, claimed.token, value]);
  });
  try {
    await withLessonRunner(async (signal) => { await reapLessonContainers(); return runSandbox(id, claimed.policy.image, { mode: "execute", input: claimed.input, inputHash: claimed.row.inputHash }, async (frame) => {
      await ownership.assertHeld();
      if (frame.kind !== "capture") throw Error("Unexpected execution frame");
      const value = readCapture(frame.value, claimed.row.inputHash), expected = (previous?.sequence ?? 0) + 1;
      if (value.source !== claimed.input.source || value.sequence !== expected || value.throughUs !== captureCuts(claimed.input)[expected - 1] ||
        contentHash(value.checkpoints.slice(0, -1)) !== contentHash(previous?.checkpoints ?? [])) throw Error("Child capture sequence, history or source mismatch");
      continuing = await ownership.transaction(async (db) => {
        const row = (await db.query<InternalRunRow>('SELECT * FROM "InternalModel2Run" WHERE id=$1 AND token=$2 AND status=\'running\' FOR UPDATE', [id, claimed.token])).rows[0];
        if (!row) return false;
        if (row.sequence !== expected - 1) throw Error("Durable capture sequence changed");
        const grant = (await db.query('SELECT 1 FROM "InternalModel2Grant" WHERE "userId"=$1', [row.ownerId])).rowCount;
        const stop = row.cancelRequested || !grant;
        await db.query(`UPDATE "InternalModel2Run" SET evidence=$3,sequence=$4,"throughUs"=$5,status=$6,reason=$7,"updatedAt"=now() WHERE id=$1 AND token=$2 AND status='running'`,
          [id, claimed.token, value, value.sequence, value.throughUs, stop ? "cancelled" : "running", stop ? "Cancellation or authorization loss; retained committed prefix" : null]);
        return !stop;
      });
      previous = value;
      return { sequence: value.sequence, fingerprint: value.fingerprint, continue: continuing };
    }, receipt, signal); });
    if (!continuing) return;
    if (!previous?.model.capture.reachedHorizon || previous.sequence !== captureCuts(claimed.input).length) throw Error("Child stopped before the complete modeled horizon");
    await ownership.transaction(async (db) => {
      // Recheck cancellation/grant after successful process exit, before terminal commit.
      await db.query(`UPDATE "InternalModel2Run" SET status=CASE WHEN "cancelRequested" OR NOT EXISTS (SELECT 1 FROM "InternalModel2Grant" WHERE "userId"="ownerId") THEN 'cancelled' ELSE 'completed' END,"updatedAt"=now()
        WHERE id=$1 AND token=$2 AND status='running'`, [id, claimed.token]);
    });
  } catch (error) {
    await ownership.transaction(async (db) => { await db.query(`UPDATE "InternalModel2Run" SET status='interrupted',reason=$3,"updatedAt"=now() WHERE id=$1 AND token=$2 AND status='running'`, [id, claimed.token, `Isolated execution stopped: ${reason(error)}; last durable prefix retained`]); });
  }
}
export async function replayLesson(row: InternalRunRow) {
  const record = await scopedLesson(row.id, row.inputHash);
  if (!record || record.policy.image !== lessonImage()) throw Error("The recorded isolated runner image is unavailable; no inline replay");
  readEnvelope(row.input, row.inputHash); readCapture(row.evidence, row.inputHash);
  let result: unknown;
  await withLessonRunner(async (signal) => { await reapLessonContainers(); return runSandbox(randomUUID(), record.policy.image, { mode: "replay", row }, async (frame) => {
    if (frame.kind !== "replay" || result !== undefined || !["MatchesRecordedPrefix", "Mismatch"].includes(frame.value?.kind)) throw Error("Invalid replay protocol");
    result = frame.value;
  }, async () => {}, signal, row.id); });
  if (result === undefined) throw Error("No isolated replay result");
  return result;
}
export async function reapLessonContainers() {
  if (!lessonImage()) return;
  const records = await internalDatabase.query('SELECT l."runId",l.policy,r.status FROM "InternalModel2LessonRun" l JOIN "InternalModel2Run" r ON r.id=l."runId"');
  if (!records.rowCount) return;
  const names = (await docker(["ps", "--all", "--filter", "label=infraforge.model2", "--format", "{{.Names}}"])).split("\n").filter(Boolean);
  for (const name of names) {
    if (!/^infraforge-model2-[a-f0-9-]{36}$/.test(name)) continue;
    let value;
    try { value = await inspectContainer(name); }
    catch (error) {
      if (!await docker(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"])) continue;
      throw error;
    }
    const origin = value.Config?.Labels?.["infraforge.model2.origin"];
    const row = records.rows.find((r) => r.runId === origin && r.policy.image === value.Image);
    if (row && (!value.State.Running || name === containerName(row.runId) && !["queued", "running"].includes(row.status))) await removeContainer(name, row.policy.image);
  }
}
const reason = (error: unknown) => (error instanceof Error ? error.message : "Lesson execution failed").slice(0, 400);
