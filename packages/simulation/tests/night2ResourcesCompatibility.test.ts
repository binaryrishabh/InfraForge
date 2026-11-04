import { expect, test } from "bun:test";
import { eventBusDesign } from "./eventBus.fixture";
import { prepare, hash } from "./asyncCanvas.fixture";
import { createProductModel2 } from "../src/model2/product/run";

// Captured on the untouched integration base before Scheduler or Functions; LF-normalized JSON.
test("wave two preserves the existing bus contract, input, assumptions and evidence", () => {
  const f = prepare(eventBusDesign()), runtime = createProductModel2(f.compiled);
  runtime.advanceTo(30_000_000);
  expect(hash(f.contract)).toBe("3ab3f9d64909ecfb69da24c67d7da075ca535c9b4812490e5e2f33480cd41433");
  expect(hash(f.compiled.input)).toBe("2e4852bef0f481f70fdda426f9841d721a228c0a66120b5ff42345acd2d86a57");
  expect(hash(f.assumptions)).toBe("636a7acd7f3144f553538214760fb27c6f534b95f6271375bd3b4bb5cbb524a5");
  expect(hash(runtime.evidence())).toBe("d0204aa22112f266aeb0d77e4b4f23547a68ee1380bd8d6f521d9d2a9e4c0aa2");
});
