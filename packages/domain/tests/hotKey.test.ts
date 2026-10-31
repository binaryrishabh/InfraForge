import { expect, test } from "bun:test";
import { dataKeyspaceError } from "../src/resource";

test("database keyspaces accept only the optional bounded access patterns", () => {
  for (const accessPattern of [undefined, "uniform", "hot-key"]) for (const count of [1, 10, 1000]) {
    expect(dataKeyspaceError("Database", { version: 1, count, ...(accessPattern ? { accessPattern } : {}) })).toBeUndefined();
  }
  for (const accessPattern of [null, "zipf", "", 80, {}, []]) expect(dataKeyspaceError("Database", { version: 1, count: 10, accessPattern })).toBeString();
  expect(dataKeyspaceError("Cache", { version: 1, count: 10, accessPattern: "hot-key" })).toBeString();
});
