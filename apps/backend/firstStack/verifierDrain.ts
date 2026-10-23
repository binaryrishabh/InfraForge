// Nine serial 75-second supervisors (visible + up to eight hidden), plus 45 s
// for DB/control cleanup. This is a containment deadline, not a latency promise.
export const verifierDrainMs = 720_000;
export async function drainVerifierWorker(worker: { pause(immediate: boolean): Promise<void>; close(): Promise<void> },
  loop: Promise<void>) {
  // BullMQ close disconnects the blocking connection before waiting. Keep it live
  // while the active scored job still needs dependency checks and lock renewal.
  await worker.pause(true);
  await loop;
  await worker.close();
}
export async function boundedVerifierDrain(task: Promise<void>, expire: () => void, timeoutMs = verifierDrainMs) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expire(); reject(Error("Verifier drain deadline exceeded; recovery required")); },
        timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
