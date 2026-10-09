import { expect, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import { errorMessage } from "../src/api/errorMessage";

test("uses a string API error message", () => {
  const response = { data: { message: "Deployment is no longer live" } } as AxiosResponse;
  expect(errorMessage(new AxiosError("Request failed", undefined, undefined, undefined, response), "Fallback"))
    .toBe("Deployment is no longer live");
});

test("rejects non-string and empty API messages", () => {
  for (const message of [null, {}, 42, ""]) {
    const response = { data: { message } } as AxiosResponse;
    expect(errorMessage(new AxiosError("Request failed", undefined, undefined, undefined, response), "Fallback"))
      .toBe("Fallback");
  }
});

test("uses the fallback for network failures and unknown thrown values", () => {
  for (const error of [new AxiosError("Network Error"), undefined, null, { message: "Untrusted object" }]) {
    expect(errorMessage(error, "Fallback")).toBe("Fallback");
  }
});

test("preserves local authentication error messages", () => {
  expect(errorMessage(new Error("Incorrect password"), "Fallback")).toBe("Incorrect password");
});
