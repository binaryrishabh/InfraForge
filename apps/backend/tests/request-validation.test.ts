import { expect, test } from "bun:test";
import { SAMPLE_ARCHITECTURE } from "@infraforge/domain/examples";
import { InfrastructureBodySchema, UpdateInfrastructureBodySchema } from "../zod_schemas/infrastructure.schema";
import { SyncTopologyBodySchema } from "../zod_schemas/deployment.schema";

test("accepts existing sample resource configuration and layout metadata", () => {
  const layout = { ...SAMPLE_ARCHITECTURE, layoutVersion: 3 };
  expect<unknown>(InfrastructureBodySchema.parse({ name: "Sample architecture", layout }).layout).toEqual(layout);
  expect<unknown>(SyncTopologyBodySchema.parse({ ...SAMPLE_ARCHITECTURE, expectedRevision: 0 })).toEqual({ ...SAMPLE_ARCHITECTURE, expectedRevision: 0 });
});

test("rejects malformed resources before persistence or live reconciliation", () => {
  for (const resource of [null, 42, {}, { ...SAMPLE_ARCHITECTURE.resources[0], x: "invalid" },
    { ...SAMPLE_ARCHITECTURE.resources[0], type: "unknown" }]) {
    const layout = { resources: [resource], connectionLines: [] };
    expect(InfrastructureBodySchema.safeParse({ name: "Invalid resource", layout }).success).toBe(false);
    expect(SyncTopologyBodySchema.safeParse(layout).success).toBe(false);
  }
});

test("rejects malformed connections and prototype property IDs", () => {
  for (const connection of [null, {}, { ...SAMPLE_ARCHITECTURE.connectionLines[0], port: "invalid" }]) {
    expect(SyncTopologyBodySchema.safeParse({ resources: SAMPLE_ARCHITECTURE.resources, connectionLines: [connection] }).success)
      .toBe(false);
  }
  for (const id of ["__proto__", "constructor", "toString"]) {
    expect(SyncTopologyBodySchema.safeParse({ resources: [{ ...SAMPLE_ARCHITECTURE.resources[0], id }], connectionLines: [] }).success)
      .toBe(false);
  }
});

test("accepts empty saved drafts while retaining the current live topology requirement", () => {
  expect(InfrastructureBodySchema.safeParse({ name: "Empty draft", layout: {} }).success).toBe(true);
  expect(SyncTopologyBodySchema.safeParse({ resources: [], connectionLines: [] }).success).toBe(false);
});

test("uses the same trimmed name rule for creation and updates", () => {
  expect(InfrastructureBodySchema.parse({ name: "  Valid name  ", layout: {} }).name).toBe("Valid name");
  for (const name of ["  ab  ", " ".repeat(4), "a".repeat(31)]) {
    expect(InfrastructureBodySchema.safeParse({ name, layout: {} }).success).toBe(false);
    expect(UpdateInfrastructureBodySchema.safeParse({ name }).success).toBe(false);
  }
});
