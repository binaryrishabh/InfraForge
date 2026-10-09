import { expect, test } from "bun:test";
import { validateInfrastructureName } from "../src/validation";

test("validates the trimmed name at both API length boundaries", () => {
  expect(validateInfrastructureName("  ab  ")).toBe("Name must be at least 3 characters");
  expect(validateInfrastructureName("  abc  ")).toBeNull();
  expect(validateInfrastructureName("a".repeat(30))).toBeNull();
  expect(validateInfrastructureName("a".repeat(31))).toBe("Name must be at most 30 characters");
});
