import { expect, test } from "bun:test";
import { verifyG7, validateG7 } from "../reality/first-stack-pilots/g7-summary";

test("G7 pins actual recorded keys, INFO populations, TTL, rejected fills and stampedes without promotion", () => {
  const { summary, result } = verifyG7();
  expect(result).toMatchObject({ result: "PASS", windows: 17, stampedeBacking: [3, 1], timingPromotion: false });
  expect(result.hits + result.misses).toBe(37888);
  expect(result.fills + result.refused).toBe(result.misses);
  for (const mutate of [
    (s: typeof summary) => { s.timingPromotion = true; },
    (s: typeof summary) => { s.windows.pop(); },
    (s: typeof summary) => { s.windows[0]!.recordedKeys[0] = 99999; },
    (s: typeof summary) => { s.windows[0]!.backingCalls++; },
    (s: typeof summary) => { s.windows[0]!.hits = "1" + s.windows[0]!.hits.slice(1); },
    (s: typeof summary) => { s.stampedes[1].backingCalls = 3; },
    (s: typeof summary) => { s.invalidations[0].staleFillRefused = false; },
    (s: typeof summary) => { s.ttl[0].expiredMiss = false; },
  ]) { const copy = structuredClone(summary); mutate(copy); expect(() => validateG7(copy)).toThrow(); }
});
