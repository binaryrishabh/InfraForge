import { expect, test } from "bun:test";
import { checkSubmission } from "../browserRuns/submission";

const free = { horizonSeconds: 900, challenge: false }, attempt = { horizonSeconds: 90, challenge: true };
const load = (atSecond: number, targetLoadFraction = 1.5) => ({ atSecond, request: { kind: "load", parameters: { targetLoadFraction } } });

test("a well-formed submission is accepted as the browser sent it", () => {
  const value = { stopAtSecond: 120, actions: [load(10), { atSecond: 30, request: { kind: "chaos", parameters: { type: "crash", resourceId: "app-1" } } },
    { atSecond: 30, request: { kind: "pool-scale", parameters: { lbId: "lb", delta: 1 } } }] };
  expect(checkSubmission(value, free)).toEqual(value as never);
  expect(checkSubmission({ stopAtSecond: 90, actions: [] }, attempt)).toEqual({ stopAtSecond: 90, actions: [] });
});

test("submissions outside the run, out of order, too long or with non-replayable actions are refused", () => {
  const refuses = (value: unknown, run = free) => expect(() => checkSubmission(value, run)).toThrow();
  refuses({ stopAtSecond: 901, actions: [] });
  refuses({ stopAtSecond: 0, actions: [] });
  refuses({ stopAtSecond: 100, actions: [load(50), load(40)] });
  refuses({ stopAtSecond: 100, actions: [load(101)] });
  refuses({ stopAtSecond: 100, actions: Array.from({ length: 21 }, (_, i) => load(i)) });
  refuses({ stopAtSecond: 100, actions: [{ atSecond: 5, request: { kind: "speed", parameters: { speed: 10 } } }] });
  refuses({ stopAtSecond: 100, actions: [{ atSecond: 5, request: { kind: "chaos", parameters: { type: "crash", resourceId: "x", trigger: "challenge-experiment" } } }] });
  refuses({ stopAtSecond: 100, actions: [load(5, 3)] });
  refuses({ stopAtSecond: 90, actions: [load(5)] }, attempt);
  refuses({ stopAtSecond: 100, actions: [], extra: true });
});
