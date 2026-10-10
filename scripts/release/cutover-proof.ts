import { join } from "node:path";
import { connectDatabase, CutoverError } from "../../apps/backend/cutover/database";
import { initializeReference, checkEightMigrationBaseline } from "../../apps/backend/cutover/baseline";
import { collectEvidence } from "../../apps/backend/cutover/evidence";
import { retireLegacyRuns, retirementRequest } from "../../apps/backend/cutover/retire";
import { proveRestore } from "./backup";
import { command } from "./process";

type ProofSettings = {
  root: string; directory: string; environment: Record<string, string | undefined>;
  source: string; reference: string; restore: string; archive: string;
  request: ReturnType<typeof retirementRequest>; verifyTarget: () => Promise<void>;
  dump: () => Promise<void>; restoreDump: () => Promise<void>;
};

// The caller creates fresh local reference/restore databases and verifies their
// Docker ownership. Only the explicit source retirement changes external data.
export async function proveCutoverDatabase(settings: ProofSettings) {
  const source = connectDatabase(settings.source, "infraforge-rehearsal-source");
  const reference = connectDatabase(settings.reference, "infraforge-rehearsal-reference");
  const restore = connectDatabase(settings.restore, "infraforge-rehearsal-restore");
  try {
    await Promise.all([source.connect(), reference.connect(), restore.connect()]);
    await initializeReference(reference, new URL(settings.reference).pathname.slice(1));
    await settings.verifyTarget();
    const baseline = await checkEightMigrationBaseline(source, reference);
    if (baseline.result !== "PASS") throw new CutoverError(`Eight-migration catalog drift: ${JSON.stringify(baseline.differences)}`);
    const evidence = await collectEvidence(source);
    const statuses = Object.fromEntries(evidence.deployments.map((row) => [row.status, row.count]));
    if (evidence.counts.Infrastructure !== 28 || evidence.counts.Deployment !== 331 || evidence.counts.Outbox !== 348 ||
        statuses.completed !== 223 || statuses.failed !== 8 || statuses.live !== 4 || statuses["torn-down"] !== 96 ||
        Object.keys(statuses).length !== 4 || evidence.historicalOwners.length !== 1 ||
        evidence.historicalOwners[0]?.marker !== "test-user" || evidence.pendingOutbox) {
      throw new CutoverError("Rehearsal contents differ from the accepted production baseline; review new evidence before mutation");
    }
    const backend = join(settings.root, "apps/backend");
    const prisma = ["bun", "--no-env-file", "--no-install", "run", "--bun", "prisma"];
    const schema = await command([...prisma, "db", "pull", "--print", "--config", "prisma.config.ts"], backend,
      { ...settings.environment, DATABASE_URL: settings.reference });
    const schemaPath = join(settings.directory, "baseline.prisma");
    await Bun.write(schemaPath, schema);
    await command([...prisma, "migrate", "diff", "--from-config-datasource", "--to-schema", schemaPath,
      "--exit-code", "--config", "prisma.config.ts"], backend, { ...settings.environment, DATABASE_URL: settings.source });
    await settings.verifyTarget();
    const backup = await proveRestore(source, restore, settings.dump, settings.restoreDump, settings.archive);
    // A real restored-row corruption must fail deterministic comparison.
    await restore.query('UPDATE "Infrastructure" SET name=$1 WHERE id=(SELECT id FROM "Infrastructure" ORDER BY id LIMIT 1)', ["restore mismatch fixture"]);
    const { compareRestored } = await import("../../apps/backend/cutover/evidence");
    if (compareRestored(backup.evidence, await collectEvidence(restore)).result !== "FAIL") throw new CutoverError("Restore mismatch was not detected");
    await settings.verifyTarget();
    const retirement = await retireLegacyRuns(source, settings.request);
    return { baseline: { ...baseline, prismaDiff: "PASS" }, backup: { result: backup.result,
      archiveSHA256: backup.archiveSHA256, mismatchRejected: true }, retirement, before: backup.evidence,
      retired: await collectEvidence(source) };
  } finally { await Promise.allSettled([source.end(), reference.end(), restore.end()]); }
}
