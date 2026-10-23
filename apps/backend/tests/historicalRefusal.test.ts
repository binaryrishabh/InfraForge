import { expect, test } from "bun:test";
import { readCapture } from "../internalModel2/capture";
import { readEnvelope } from "../internalModel2/envelope";

test("records without a version keep the original refusal; unknown versions are refused as unsupported", () => {
  expect(() => readCapture({}, "input")).toThrow("Stored evidence is missing, corrupt or incompatible");
  expect(() => readCapture({ schema: 2 }, "input")).toThrow("Stored evidence is missing, corrupt or incompatible");
  expect(() => readCapture({ schema: "infraforge-internal-evidence/9" }, "input")).toThrow("Unsupported historical evidence version");
  expect(() => readEnvelope({}, "input", false)).toThrow();
  expect(() => readEnvelope({ schema: "infraforge-internal-execution/9" }, "input", false)).toThrow("Unsupported historical input version");
});
