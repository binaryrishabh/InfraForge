import { expect, test } from "bun:test";
import { captureRunInputs } from "../deployments/runInputs";
import { challengeSeed } from "../challenges/registry";
import { createModel2Engine } from "../simulator/model2Engine";
import { answers, attemptReport, definition, REFERENCE } from "./challengeHarness";

// Replay safety for the optional saved capabilities: a saved design rebuilt from its captured inputs reproduces identical evidence,
// reading evidence or the live view while the run advances never changes what the run later records, and every marked design names its profile.
const LABS: Array<[id: string, profile: string]> = [["resolve-after-publication", "dns-publication/1"], ["admit-a-replica-image", "artifact-cache/1"], ["scale-on-delivered-samples", "autoscaling-observed/1"],
  ["isolate-route-credits", "gateway-quota/1"], ["hold-slots-on-a-slow-call", "worker-wait/1"], ["redrive-after-the-fix", "queue-redrive/1"], ["serve-stale-on-error", "cache-stale/1"], ["refresh-after-a-write", "cache-invalidation/1"], ["order-the-row-locks", "row-lock-order/1"]];
// Wall-clock timestamps and random record ids are report metadata, not simulated state.
const simulated = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x) ? "~" : x);
const ANSWERS = { "overall-health": "healthy", "scale-out": "no", where: "app" };

for (const [id, profile] of LABS) test(`${id}: marked inputs name ${profile}, rebuild identically, and reading does not change the run`, () => {
  const d = definition(id), design = REFERENCE[id] ?? d.starter!, seconds = d.evaluationSeconds;
  const input = captureRunInputs(design, d.workload, challengeSeed(d));
  expect(input.adapterProfiles as string[]).toContain(profile);
  expect(captureRunInputs(design, d.workload, challengeSeed(d))).toEqual(input); // captured inputs are a pure function of the saved design, workload and seed
  const quiet = createModel2Engine(input, seconds), watched = createModel2Engine(JSON.parse(JSON.stringify(input)), seconds);
  for (let s = 1; s <= seconds; s++) { quiet.advance(); watched.advance(); if (s % 3 === 0) { watched.view(); watched.evidence(); } }
  expect(JSON.stringify(watched.evidence())).toBe(JSON.stringify(quiet.evidence()));
}, 120000);

for (const [id] of LABS) test(`${id}: the scored reference attempt (faults, scenario and criteria included) is reproducible`, () => {
  const d = definition(id), a = attemptReport(d, REFERENCE[id] ?? d.starter!, answers(d, ANSWERS)), b = attemptReport(d, REFERENCE[id] ?? d.starter!, answers(d, ANSWERS));
  expect(simulated(b.terminal)).toBe(simulated(a.terminal));
  expect(simulated(b.challenge)).toBe(simulated(a.challenge));
  expect(a.challenge?.criteria.some(c => c.status === "met")).toBe(true);
}, 170000);
