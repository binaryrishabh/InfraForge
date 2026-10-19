import { expect, test } from "bun:test";
import { authorizeCapability, executionAllowance, requireCapability, type CapabilityPolicy, type CapabilityRequest } from "../capabilities/policy";

const requests: CapabilityRequest[] = [
  { capability: "run.start", purpose: "engineer", engine: "1", profile: null, durationSeconds: null },
  { capability: "run.start", purpose: "learner", engine: "1", profile: "challenge/1", durationSeconds: 120 },
  { capability: "run.start", purpose: "operator", engine: "2", profile: "bounded-connected-web/1", durationSeconds: 1 },
  { capability: "load.recorded.accept", bytes: 1024, rows: 10, durationSeconds: 1, scale: 1 },
  { capability: "design.persist", operation: "create", countDelta: 1 },
  { capability: "design.persist", operation: "update", countDelta: 0 },
  { capability: "artifact.export", artifactId: "run", format: "html", scope: "run" },
  { capability: "run.control", runId: "run", control: "load" },
];
test("all supported capabilities are free with explicit absence of a commercial cap", () => {
  for (const request of requests) expect(requireCapability("owner", request)).toMatchObject({ allowed: true, revision: "all-free/1", allowance: { kind: "no-commercial-cap" } });
});
test("a replacement provider receives subject/request/unknown usage and refuses before an effect", () => {
  let effects = 0;
  const deny: CapabilityPolicy = { authorize(subject, request, usage) {
    expect(subject.ownerId).toBe("owner"); expect(request.capability).toBeDefined();
    expect(usage).toEqual({ activeRuns: null, savedDesigns: null });
    return { allowed: false, revision: "deny-test/1", reason: "Not available", allowance: { kind: "unavailable" } };
  } };
  for (const request of requests) expect(() => { requireCapability("owner", request, deny); effects++; }).toThrow("Not available");
  expect(effects).toBe(0);
});
test("missing subjects and unknown capability keys fail closed", () => {
  expect(authorizeCapability({ ownerId: "" }, requests[0]!).allowed).toBe(false);
  expect(authorizeCapability({ ownerId: "owner" }, { capability: "unknown" } as unknown as CapabilityRequest).allowed).toBe(false);
});
test("worker allowance preserves recorded horizons and distinguishes open-ended from zero", () => {
  expect(executionAllowance(null).durationSeconds).toBeNull();
  expect(executionAllowance(120).durationSeconds).toBe(120);
  for (const duration of [0, -1, NaN, Infinity]) expect(() => executionAllowance(duration)).toThrow("Invalid recorded");
});
