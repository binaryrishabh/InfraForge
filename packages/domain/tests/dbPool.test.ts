import { expect, test } from "bun:test";
import { dbPoolError } from "../src/resource";
test("transport pool accepts only owned bounded integers or absence", () => {
 for (const value of [undefined, 1, 10, 512]) expect(dbPoolError("Database", value)).toBeUndefined();
 for (const value of [null, "2", {}, [], 0, -1, 1.5, 513, NaN, Infinity]) expect(dbPoolError("Database", value)).toBeString();
 for (const type of ["Virtual Machine", "Cache", "Serverless Function"]) expect(dbPoolError(type, 2)).toBeString();
});
