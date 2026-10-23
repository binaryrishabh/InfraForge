// Redis queue pause atomically prevents new claims without ending worker.run()
// or disconnecting its blocking connection. Active includes the whole scored job.
// The caller closes admission first and bounds this operation independently.
export async function renewBetweenJobs(queue: { pause(): Promise<void>; resume(): Promise<void>; getActiveCount(): Promise<number> },
  renew: () => Promise<void>, stopping: () => boolean) {
  await queue.pause();
  while (!stopping()) {
    const active = await queue.getActiveCount();
    if (!Number.isSafeInteger(active) || active < 0 || active > 1) throw Error("Verifier active capacity Unknown");
    if (active === 0) break;
    await Bun.sleep(100);
  }
  if (stopping()) return;
  await renew();
  // Failure deliberately leaves the queue paused for operator review.
  if (!stopping()) await queue.resume();
}
