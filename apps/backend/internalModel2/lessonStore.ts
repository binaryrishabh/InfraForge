import { internalDatabase } from "./store";
import { readLessonPolicy } from "./lessonPolicy";
export async function grantScope(owner: string): Promise<"operator" | "lesson" | null> {
  const scope = (await internalDatabase.query('SELECT scope FROM "InternalModel2Grant" WHERE "userId"=$1', [owner])).rows[0]?.scope;
  return scope === "operator" || scope === "lesson" ? scope : null;
}
export async function lessonRecord(id: string) {
  return (await internalDatabase.query('SELECT policy,receipt FROM "InternalModel2LessonRun" WHERE "runId"=$1', [id])).rows[0] as { policy: unknown; receipt: unknown } | undefined;
}
export async function withLessonRunner<T>(run: (signal: AbortSignal) => Promise<T>) {
  const client = await internalDatabase.connect(); let acquired = false;
  const control = new AbortController(), lost = () => control.abort(); client.on("error", lost);
  try {
    acquired = (await client.query('SELECT pg_try_advisory_lock(186542854,20) AS held')).rows[0].held;
    if (!acquired) throw Error("The isolated runner is busy; retry later. No execution started.");
    const value = await run(control.signal);
    if (control.signal.aborted) throw Error("Isolated runner ownership lost");
    return value;
  } finally {
    if (acquired) await client.query('SELECT pg_advisory_unlock(186542854,20)').catch(lost);
    client.removeListener("error", lost); client.release(control.signal.aborted);
  }
}
export async function scopedLesson(id: string, inputHash: string) {
  const value = await lessonRecord(id); return value ? { ...value, policy: readLessonPolicy(value.policy, inputHash) } : null;
}
