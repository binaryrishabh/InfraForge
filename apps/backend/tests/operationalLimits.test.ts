import { expect, test } from "bun:test";
import { lifetimeExpired, readOperationalLimits, runtimeHorizon } from "../deployments/operationalLimits";
import { executionAllowance } from "../capabilities/policy";
import { readActionRequest } from "../actions/contract";

test("operational horizons bound freeform and recorded runs independently of commercial policy", () => {
  const limits = readOperationalLimits({});
  expect(executionAllowance(null).durationSeconds).toBeNull();
  expect(runtimeHorizon(null, limits)).toBe(900);
  expect(runtimeHorizon(120, limits)).toBe(120);
  expect(runtimeHorizon(7200, limits)).toBe(3600);
  expect(runtimeHorizon(null, { ...limits, runtimeSeconds: 100 })).toBe(100);
  for (const value of [0, -1, Infinity, NaN, 1.5]) expect(() => runtimeHorizon(value, limits)).toThrow();
  expect(lifetimeExpired(new Date(0), 1799999, limits)).toBe(false);
  expect(lifetimeExpired(new Date(0), 1800000, limits)).toBe(true);
  expect(readActionRequest({ kind: "teardown", parameters: { trigger: "operational-limit" } })).toMatchObject({ kind: "teardown" });
});

test("operational settings require finite positive integers", () => {
  for (const name of ["MODEL1_OWNER_RESERVATIONS", "MODEL1_GLOBAL_RESERVATIONS", "MODEL1_QUEUED_RESERVATIONS",
    "MODEL1_ACTIVE_RESERVATIONS", "MODEL1_ADMISSION_BYTES", "MODEL1_FREEFORM_SECONDS", "MODEL1_RUNTIME_SECONDS", "MODEL1_LIFETIME_SECONDS"]) {
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity"]) expect(() => readOperationalLimits({ [name]: value })).toThrow(name);
  }
  expect(readOperationalLimits({ MODEL1_OWNER_RESERVATIONS: "1" }).perOwner).toBe(1);
});
