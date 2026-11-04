import { expect, test } from "bun:test";
import { capacitySetup } from "./queueCapacity.fixture";
import { hash } from "./asyncCanvas.fixture";

// Captured on d299be5 before adding resource modules; LF-normalized JSON.
test("existing queue design retains its contract, input, assumptions and evidence", () => {
  const f = capacitySetup(); f.runtime.advanceTo(70_000_000);
  expect(hash(f.contract)).toBe("82a9673cb4b36f8a2c5fe4d3d2ee13b6d372555602ed45441d327fec578e9c4f");
  expect(hash(f.compiled.input)).toBe("72f03c8f8a5867f9a905b9abc46a967bcd0e0071012620d81eff318132febdf1");
  expect(hash(f.assumptions)).toBe("fde40806e9d0323e26c114c1bfa80166dd32ac18143f4be8be149f64c85aad03");
  expect(hash(f.runtime.evidence())).toBe("813b1d20bc65c2a53b60e496d2b8b2d68e84c8a682d8b7ead4300cbe1e5a10c1");
});
