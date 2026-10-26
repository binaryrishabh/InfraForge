import { expect, test } from "bun:test";
import { AxiosError } from "axios";
import { http } from "../src/client/httpClient";
import { capability } from "../src/api/internalLesson.api";

test("disabled builds skip the internal probe and unavailable features resolve to no access", async () => {
  const original = http.defaults.adapter;
  const enabled = process.env.VITE_INTERNAL_MODEL2_ENABLED;
  let requests = 0;
  let status = 404;
  let scope: "operator" | "lesson" = "operator";
  http.defaults.adapter = async (config) => {
    requests++;
    const response = { data: { scope }, status, statusText: "Test response", headers: {}, config };
    if (!config.validateStatus?.(status)) throw new AxiosError("Request failed", "ERR_BAD_RESPONSE", config, undefined, response);
    return response;
  };
  try {
    delete process.env.VITE_INTERNAL_MODEL2_ENABLED;
    expect(await capability()).toBeNull();
    expect(requests).toBe(0);
    process.env.VITE_INTERNAL_MODEL2_ENABLED = "true";
    expect(await capability()).toBeNull();
    status = 200;
    for (scope of ["operator", "lesson"] as const) expect(await capability()).toEqual({ scope });
    for (status of [403, 500]) await expect(capability()).rejects.toThrow("Request failed");
  } finally {
    http.defaults.adapter = original;
    if (enabled === undefined) delete process.env.VITE_INTERNAL_MODEL2_ENABLED;
    else process.env.VITE_INTERNAL_MODEL2_ENABLED = enabled;
  }
});
