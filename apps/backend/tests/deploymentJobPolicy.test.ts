import { expect, test } from "bun:test";
import { deploymentFailureStatus, isRetiredDeployment } from "../utils/deploymentJobPolicy";

test("keeps transient job failures eligible for all configured attempts", () => {
  expect<string>(deploymentFailureStatus(0, 3)).toBe("running");
  expect<string>(deploymentFailureStatus(1, 3)).toBe("running");
  expect<string>(deploymentFailureStatus(2, 3)).toBe("failed");
  expect<string>(deploymentFailureStatus(0)).toBe("failed");
});

test("does not rerun completed, failed or torn-down environments", () => {
  for (const status of ["completed", "failed", "torn-down"]) expect(isRetiredDeployment(status)).toBe(true);
  for (const status of ["pending", "running", "live"]) expect(isRetiredDeployment(status)).toBe(false);
});
