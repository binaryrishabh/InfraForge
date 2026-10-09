export type Release = { sha: string; image: string; imageId: string; migrationFingerprint: string; authContract: number; settingsFingerprint: string };
export interface ReleaseOperations {
  preflight(): Promise<void>;
  stop(): Promise<void>;
  migrate(): Promise<void>;
  postcheck(): Promise<void>;
  start(release: Release): Promise<void>;
  ready(release: Release): Promise<void>;
  save(release: Release, previous?: Release): Promise<void>;
}

export function assertRollbackCompatible(current: Release, previous: Release) {
  if (current.migrationFingerprint !== previous.migrationFingerprint || current.authContract !== previous.authContract ||
    current.settingsFingerprint !== previous.settingsFingerprint || previous.authContract !== 1) {
    throw new Error("Rollback cannot reverse database/authentication/configuration changes; restore or repair forward under a separate plan");
  }
}

export async function releaseSequence(operations: ReleaseOperations, next: Release, current?: Release) {
  await operations.preflight();
  await operations.stop();
  // A failed/partially applied migration must never start the old application.
  await operations.migrate();
  await operations.postcheck();
  try {
    await operations.start(next);
    await operations.ready(next);
  } catch (error) {
    await operations.stop();
    if (current) {
      assertRollbackCompatible(next, current);
      await operations.start(current);
      try { await operations.ready(current); }
      catch { await operations.stop(); throw new Error("Release and rollback readiness failed; application is stopped"); }
    }
    throw error;
  }
  await operations.save(next, current);
}

export async function rollbackSequence(operations: ReleaseOperations, current: Release, previous: Release) {
  assertRollbackCompatible(current, previous);
  await operations.preflight();
  await operations.stop();
  await operations.postcheck();
  try { await operations.start(previous); await operations.ready(previous); }
  catch (error) { await operations.stop(); throw error; }
  await operations.save(previous, current);
}
