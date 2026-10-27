export type Release = { sha: string; image: string; imageId: string; migrationFingerprint: string; authContract: number; settingsFingerprint: string };
export interface ReleaseOperations {
  preflight(): Promise<void>;
  stop(): Promise<void>;
  /** Start the stopped previous containers exactly as they were (no recreate, no new settings). */
  resume(): Promise<void>;
  /** Stop a migration container a timed-out command may have left running. */
  stopMigration(): Promise<void>;
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

/** The release failed but the previous release was restored and is serving again. */
export class PreviousReleaseRestored extends Error {}
const step = (name: string) => console.log(`release step: ${name} at ${new Date().toISOString()}`);

export async function releaseSequence(operations: ReleaseOperations, next: Release, current?: Release) {
  step("preflight"); await operations.preflight();
  step("stop"); await operations.stop();
  try {
    step("migrate"); await operations.migrate();
    step("postcheck"); await operations.postcheck();
  } catch (error) {
    // Same migration fingerprint: there was nothing to apply, so the database is unchanged and
    // the stopped previous containers can start again exactly as they were. A real schema change
    // may be partly applied, so that case still stays stopped for the operator.
    if (!current || next.migrationFingerprint !== current.migrationFingerprint) throw error;
    step("restore previous release");
    try { await operations.stopMigration(); await operations.resume(); await operations.ready(current); }
    catch (restoreError) {
      await operations.stop().catch(() => {});
      throw new Error(`Release failed and the previous release could not be restored: ${(restoreError as Error).message}`, { cause: error });
    }
    throw new PreviousReleaseRestored(`Release failed; previous release ${current.sha} restored: ${(error as Error).message}`, { cause: error });
  }
  step("start");
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
