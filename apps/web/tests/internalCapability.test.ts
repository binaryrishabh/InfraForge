import { expect, test } from "bun:test";
import { AxiosError } from "axios";
import { http } from "../src/client/httpClient";
import { capability } from "../src/api/internalLesson.api";

test("an unavailable internal feature resolves to no access while real failures still reject", async () => {
  const original = http.defaults.adapter;
  let status = 404;
  let scope = "operator";
  http.defaults.adapter = async (config) => {
    const response = { data: { scope }, status, statusText: "Test response", headers: {}, config };
    if (!config.validateStatus?.(status)) throw new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, undefined, response);
    return response;
  };
  try {
    expect(await capability()).toBeNull();
    status = 200;
    for (scope of ["operator", "lesson"]) expect(await capability()).toEqual({ scope });
    for (status of [403, 500]) await expect(capability()).rejects.toThrow("Request failed");
  } finally { http.defaults.adapter = original; }
});
