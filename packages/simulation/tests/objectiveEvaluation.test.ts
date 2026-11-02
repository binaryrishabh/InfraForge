import { expect, test } from "bun:test";
import { evaluateObjective } from "../src/model2/workload/objective";
import { objectiveEvidence } from "../src/model2/workload/objectiveEvidence";

test("cumulative bounds determine unknown, undetermined, met and already missed", () => {
  expect(evaluateObjective({ good: 0, pending: 0, offered: 0 }, 95)).toEqual({ status: "unknown", measuredFraction: null, worstCaseFraction: null, bestCaseFraction: null });
  expect(evaluateObjective({ good: 9, pending: 1, offered: 10 }, 95)).toEqual({ status: "undetermined", measuredFraction: 0.9, worstCaseFraction: 0.9, bestCaseFraction: 1 });
  expect(evaluateObjective({ good: 9, pending: 1, offered: 10 }, 90).status).toBe("met");
  expect(evaluateObjective({ good: 8, pending: 1, offered: 10 }, 95)).toEqual({ status: "missed", measuredFraction: 0.8, worstCaseFraction: 0.8, bestCaseFraction: 0.9 });
});

test("captured decimal targets use exact integer comparisons, including sub-basis-point values", () => {
  expect(evaluateObjective({ good: 999900, pending: 0, offered: 1000000 }, 99.99).status).toBe("met");
  expect(evaluateObjective({ good: 999899, pending: 0, offered: 1000000 }, 99.99).status).toBe("missed");
  // Binary multiplication rounds 66.66666666666667 * 3 to 200; that must not decide the status.
  expect(evaluateObjective({ good: 2, pending: 0, offered: 3 }, 66.66666666666667).status).toBe("missed");
  expect(evaluateObjective({ good: 2, pending: 0, offered: 3 }, 66.66666666666666).status).toBe("met");
  expect(evaluateObjective({ good: 1, pending: 1, offered: 3 }, 66.66666666666667).status).toBe("missed");
  expect(evaluateObjective({ good: 1, pending: 1, offered: 3 }, 66.66666666666666).status).toBe("undetermined");
});

test("pending can decide the run at the horizon, then completion or aging resolves it honestly", () => {
  const policy = { version: 1 as const, maxResponseMs: 1, targetSuccessPercent: 90 };
  const e = objectiveEvidence(policy, 1000);
  expect(e.measure(0, 0, []).status).toBe("unknown");
  const live = [{ work: { offeredAt: 0 } }];
  expect(e.measure(1, 0, live).status).toBe("undetermined");
  expect(e.measure(1, 1000, live)).toMatchObject({ status: "undetermined", pending: 1, throughUs: 1000, horizonUs: 1000 });
  e.finish("completed", 1000);
  expect(e.measure(1, 1000, []).status).toBe("met");
  const aged = objectiveEvidence(policy, 2000);
  expect(aged.measure(1, 1001, live)).toMatchObject({ status: "missed", unresolvedPastThreshold: 1, bestCaseFraction: 0 });
  aged.finish("completed", 1002);
  expect(aged.measure(1, 1002, [])).toMatchObject({ status: "missed", late: 1 });
});

test("a later failure can change met to undetermined or missed as the denominator grows", () => {
  expect(evaluateObjective({ good: 9, pending: 0, offered: 10 }, 90).status).toBe("met");
  expect(evaluateObjective({ good: 9, pending: 1, offered: 11 }, 90).status).toBe("undetermined");
  expect(evaluateObjective({ good: 9, pending: 0, offered: 11 }, 90).status).toBe("missed");
});
