import Redis from "ioredis";
import { Pool } from "pg";
import { createReadinessCache } from "../health/readinessCache";
import { verifyWorkerSession, workerDatabaseUrl } from "../infra/workerConnection";
import { IsolationConnection } from "./isolationConnection";
import { createLiveQualification, readProtectedJson } from "./verifierQualification";
import { availabilityMaxAgeMs, engineAvailability, verifierAvailabilityKey } from "./verifierAvailability";
import { startSubmissionQueue } from "./submissionQueue";
import type { SubmissionVerifier } from "./submissionWorker";
import { boundedVerifierDrain } from "./verifierDrain";
import { createHostFingerprintReader, assertLiveHeadroom } from "./qualificationFingerprint";
import { checkFirstStackCanary } from "./isolationRunner";
import { withFirstStackOwnership } from "./isolationOwnership";
import { acquireVerifierOwnership } from "./verifierOwnership";
import { renewBetweenJobs } from "./verifierRenewal";
import { assertVerifierProductionResponsive } from "./verifierProductionProbe";

export interface VerifierSettings { enabled: boolean; image: string; endpoint: string; qualification: string }
export function createVerifierLifecycle(settings: VerifierSettings, source: string,
  env: Record<string, string | undefined>) {
  let start: ReturnType<typeof launchVerifier> | undefined;
  // A rejected start remains rejected. Never retry recovery in the same process.
  return { start: () => start ??= launchVerifier(settings, source, env) };
}

async function launchVerifier(settings: VerifierSettings, source: string, env: Record<string, string | undefined>) {
  if (!settings.enabled) throw Error("First-stack admission disabled");
  const databaseUrl = workerDatabaseUrl({ ...env, NODE_ENV: "production" });
  await verifyWorkerSession(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2000,
    query_timeout: 2000, statement_timeout: 2000, lock_timeout: 1000 });
  const redisOptions = { host: env.REDIS_HOST ?? "127.0.0.1", port: Number(env.REDIS_PORT ?? 6380),
    enableOfflineQueue: false, connectTimeout: 2000, retryStrategy: () => 1000 };
  const producer = new Redis({ ...redisOptions, maxRetriesPerRequest: 1, commandTimeout: 2000 });
  // Blocking reads must not have a command timeout. The separate producer is bounded.
  const consumer = new Redis({ ...redisOptions, maxRetriesPerRequest: null });
  let control: IsolationConnection | undefined;
  let queue: Awaited<ReturnType<typeof startSubmissionQueue>> | undefined;
  let cache: ReturnType<typeof createReadinessCache> | undefined;
  let stopping = false, dependencies = false, generation = 0, lastHealthy = 0;
  let publishing: Promise<unknown> = Promise.resolve();
  let deleting = false;
  let maintenance = false, renewalFailed = false, renewal: Promise<void> | undefined;
  const invalidate = () => {
    generation++; dependencies = false; cache?.invalidate();
    // Serialize with publishing so a successful in-flight SET cannot follow this DELETE.
    // At most one deletion may wait; dependency error storms cannot grow a promise queue.
    if (!deleting && producer.status === "ready") {
      deleting = true;
      publishing = publishing.catch(() => {}).then(() => producer.del(verifierAvailabilityKey))
        .catch(() => {}).finally(() => { deleting = false; });
    }
  };
  producer.on("error", invalidate); producer.on("close", invalidate);
  consumer.on("error", invalidate); consumer.on("close", invalidate); pool.on("error", invalidate);
  try {
    control = await IsolationConnection.open(settings.endpoint);
    const configuration: SubmissionVerifier = {
      admission: { enabled: settings.enabled, engine: { image: settings.image, source } },
      isolation: { image: settings.image, source, qualification: null }, control,
      healthy: () => dependencies && Date.now() - lastHealthy < availabilityMaxAgeMs,
    };
    const fingerprint = createHostFingerprintReader(control);
    const qualification = createLiveQualification(configuration.isolation, control, {
      load: () => readProtectedJson(settings.qualification),
      fingerprint: async () => (await fingerprint()).fingerprint,
      headroom: async () => { assertLiveHeadroom(); await assertVerifierProductionResponsive(); },
      canary: async baseline => {
        const canary = await readProtectedJson("/etc/infraforge/verifier/canary.json", 2 * 1024 * 1024);
        await withFirstStackOwnership(databaseUrl, {
          check: async db => { await db.query("SELECT 1"); },
          commit: async () => { throw Error("Canary must never persist product data"); },
        }, async (authority, signal) => {
          await checkFirstStackCanary(control!, baseline, (await fingerprint()).fingerprint, canary, authority, signal);
        });
      },
    });
    // A second lifecycle cannot take a canary slot between another worker's jobs.
    // Release this temporary session before the queue acquires its own lifecycle
    // session. A competing startup in that gap makes queue startup refuse safely.
    const startup = await acquireVerifierOwnership(databaseUrl, qualification.revoke);
    try { await qualification.renew(); await startup.assertHeld(); }
    finally { await startup.close(); }
    dependencies = true; lastHealthy = Date.now();
    queue = await startSubmissionQueue(pool, databaseUrl, producer, consumer, configuration,
      { enabled: false }, invalidate);
    await queue.queue.resume();
    cache = createReadinessCache(async () => {
      const began = generation;
      try {
        await qualification.refresh();
        await queue!.health(() => stopping);
        await pool.query("SELECT 1");
        if (await producer.ping() !== "PONG" || consumer.status !== "ready") throw Error("Redis unavailable");
        if (began !== generation) return { success: false };
        dependencies = true; lastHealthy = Date.now();
        if (!stopping && !maintenance && !renewalFailed && qualification.due()) {
          maintenance = true;
          publishing = publishing.catch(() => {}).then(() => producer.del(verifierAvailabilityKey)).catch(() => {});
          // Do not block the one-second identity/dependency probe while draining
          // or running the bounded canary. Active work retains its existing lease.
          renewal = boundedVerifierDrain(renewBetweenJobs(queue!.queue,
            () => qualification.renew(), () => stopping), () => { qualification.revoke(); invalidate(); })
            .catch(() => { renewalFailed = true; qualification.revoke(); invalidate(); })
            .finally(() => { maintenance = false; renewal = undefined; });
        }
        if (stopping || maintenance || renewalFailed) return { success: false };
        const checkedAt = Date.now();
        const snapshot = { image: settings.image, source, checkedAt,
          expiresAt: checkedAt + availabilityMaxAgeMs,
          qualifiedUntil: Date.parse(configuration.isolation.qualification!.expiresAt) };
        publishing = publishing.catch(() => {}).then(() => producer.set(verifierAvailabilityKey,
          JSON.stringify(snapshot), "PX", availabilityMaxAgeMs));
        await publishing;
        return { success: true };
      } catch { invalidate(); return { success: false }; }
    }, { intervalMs: 1000, maxAgeMs: availabilityMaxAgeMs });
    await cache.started;
    let closing: Promise<void> | undefined;
    return {
      operations: () => queue!.operations(),
      availability() {
        const checkedAt = Date.now(), q = configuration.isolation.qualification;
        return engineAvailability(q ? { image: settings.image, source, checkedAt,
          expiresAt: checkedAt + availabilityMaxAgeMs, qualifiedUntil: Date.parse(q.expiresAt) } : null,
        configuration.admission.engine, !stopping && !maintenance && !renewalFailed && dependencies && cache!.check().success);
      },
      close: () => closing ??= boundedVerifierDrain((async () => {
        stopping = true; cache!.invalidate();
        // Stop claims immediately, even if Redis cannot delete the short-lived snapshot.
        const draining = queue!.close();
        void draining.catch(() => {});
        publishing = publishing.catch(() => {}).then(() => producer.del(verifierAvailabilityKey)).catch(() => {});
        await publishing;
        // Keep qualification/dependency probes running while the whole scored job drains.
        await draining;
        await renewal;
        await cache!.close();
        await control!.close(); producer.disconnect(); consumer.disconnect(); await pool.end();
      })(), invalidate),
    };
  } catch (error) {
    invalidate(); await queue?.close(); await cache?.close(); await control?.close();
    producer.disconnect(); consumer.disconnect(); await pool.end(); throw error;
  }
}
