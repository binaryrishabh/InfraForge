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

test("versioned interventions enforce strict parameters, bounds, remaining horizon and challenge origin", () => {
  const action = {atSecond: 5, request: {kind: "intervention", parameters: {interventionId: "session-capacity", revision: 1, target: {resourceId: "db"}, parameters: {sessions: 0, duration: 2}}}};
  const submit = (a: unknown = action, run = free) => checkSubmission({stopAtSecond: 10, actions: [a]}, run);
  expect(submit()).toEqual({stopAtSecond: 10, actions: [action]} as never);
  for (const parameters of [{sessions: -1, duration: 2}, {sessions: 0.1, duration: 2}, {sessions: 0, duration: 301}, {sessions: 0, duration: 2, extra: true}])
    expect(() => submit({...action, request: {...action.request, parameters: {...action.request.parameters, parameters}}})).toThrow();
  expect(() => submit({...action, request: {...action.request, parameters: {...action.request.parameters, revision: 2}}})).toThrow();
  expect(() => submit({...action, request: {...action.request, parameters: {...action.request.parameters, trigger: "challenge-experiment"}}})).toThrow();
  expect(() => submit(action, attempt)).toThrow("challenge");
  expect(() => submit({...action, atSecond: 899})).toThrow();
  expect(() => checkSubmission({stopAtSecond: 900, actions: [{...action, atSecond: 899}]}, free)).toThrow("BOUNDS");
});

test("deny-port wire uses the capability bounds and revision", () => {
  const request = {kind: "intervention", parameters: {interventionId: "deny-port", revision: 1, target: {resourceId: "firewall"}, parameters: {port: 5432, duration: 2}}};
  const submit = (r: unknown) => checkSubmission({stopAtSecond: 10, actions: [{atSecond: 1, request: r}]}, free);
  expect(submit(request).actions).toHaveLength(1);
  for (const port of [0, 65536, 0.5]) expect(() => submit({...request, parameters: {...request.parameters, parameters: {port, duration: 2}}})).toThrow();
  expect(() => submit({...request, parameters: {...request.parameters, revision: 2}})).toThrow();
});
