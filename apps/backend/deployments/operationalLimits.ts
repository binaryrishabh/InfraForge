// Initial containment policy for the host in ops/BACKEND_CAPACITY.md, not measured capacity.
export function readOperationalLimits(env: Record<string, string | undefined> = process.env) {
  const integer = (setting: string | undefined, name: string, fallback: number) => {
    const value = setting === undefined ? fallback : Number(setting);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}: expected a positive integer`);
    return value;
  };
  return Object.freeze({
    perOwner: integer(env.MODEL1_OWNER_RESERVATIONS, "MODEL1_OWNER_RESERVATIONS", 2),
    // Server work only: queued, in gates, live or replaying. Browser runs cost the server nothing while they run.
    global: integer(env.MODEL1_GLOBAL_RESERVATIONS, "MODEL1_GLOBAL_RESERVATIONS", 24),
    queued: integer(env.MODEL1_QUEUED_RESERVATIONS, "MODEL1_QUEUED_RESERVATIONS", 20),
    active: integer(env.MODEL1_ACTIVE_RESERVATIONS, "MODEL1_ACTIVE_RESERVATIONS", 2),
    inputBytes: integer(env.MODEL1_ADMISSION_BYTES, "MODEL1_ADMISSION_BYTES", 128 * 1024),
    freeformSeconds: integer(env.MODEL1_FREEFORM_SECONDS, "MODEL1_FREEFORM_SECONDS", 900),
    runtimeSeconds: integer(env.MODEL1_RUNTIME_SECONDS, "MODEL1_RUNTIME_SECONDS", 3600),
    lifetimeSeconds: integer(env.MODEL1_LIFETIME_SECONDS, "MODEL1_LIFETIME_SECONDS", 1800),
  });
}
export const operationalLimits = readOperationalLimits();
export type OperationalLimits = ReturnType<typeof readOperationalLimits>;
export const reservationWhere = { OR: [{ status: { notIn: ["completed", "failed", "torn-down"] } }, { runtimeActive: true }] };
export const serverWorkWhere = { OR: [{ status: { in: ["pending", "running", "live"] } }, { runtimeActive: true }] };
export function runtimeHorizon(recorded: number | null, limits = operationalLimits) {
  if (recorded !== null && (!Number.isSafeInteger(recorded) || recorded <= 0)) throw new Error("Invalid recorded run horizon");
  return Math.min(recorded ?? limits.freeformSeconds, limits.runtimeSeconds);
}
export function lifetimeExpired(createdAt: Date, now = Date.now(), limits = operationalLimits) {
  return now - createdAt.getTime() >= limits.lifetimeSeconds * 1000;
}
