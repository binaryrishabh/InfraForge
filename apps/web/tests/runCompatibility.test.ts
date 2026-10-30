import { afterEach, expect, spyOn, test } from "bun:test";
import { RUN_CONTRACT } from "@infraforge/contracts/deployment";
import { http, API_URL } from "../src/client/httpClient";
import { createDeployment } from "../src/api/deployment.api";
import { createRerun } from "../src/api/reports.api";
import { errorMessage } from "../src/api/errorMessage";
import { requireRunCompatibility } from "../src/features/model2Run/compatibility";

const originalAdapter = http.defaults.adapter;
afterEach(() => { http.defaults.adapter = originalAdapter; });

const starts = [
  { start: () => createDeployment("design"), path: "/deployments", body: { infrastructureId: "design" } },
  { start: () => createRerun("source", "exact", true), path: "/deployments/source/reruns", body: { mode: "exact", matchedStop: true } },
  { start: () => createRerun("source", "current-design", false, "hash"), path: "/deployments/source/reruns", body: { mode: "current-design", matchedStop: false, expectedInputHash: "hash" } },
];

test("older or unknown backend refuses all freeform starts before creating a waiting run", async () => {
  for (const runContract of [undefined, null, 0, -1, RUN_CONTRACT - 1]) {
    for (const { start } of starts) {
      const requests: string[] = [];
      http.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        return { data: { success: true, runContract, availability: {} }, status: 200, statusText: "OK", headers: {}, config };
      };
      let refusal: unknown;
      try { await start(); } catch (error) { refusal = error; }
      expect(errorMessage(refusal, "Fallback")).toBe("This server does not support the required run version yet. Reload and try again shortly.");
      expect(requests).toEqual([`get ${API_URL}/deployments/capabilities`]);
    }
  }
});

test("current and newer backend preserves each creation request and returned run", async () => {
  for (const runContract of [RUN_CONTRACT, RUN_CONTRACT + 1]) {
    for (const { start, path, body } of starts) {
      const requests: Array<{ method?: string; url?: string; body: unknown }> = [];
      const deployment = { id: "created-run", status: "pending" };
      http.defaults.adapter = async (config) => {
        requests.push({ method: config.method, url: config.url, body: config.data ? JSON.parse(config.data) : undefined });
        return { data: config.method === "get" ? { runContract } : { createdDeployment: deployment }, status: 200, statusText: "OK", headers: {}, config };
      };
      expect(await start()).toMatchObject(deployment);
      expect(requests).toEqual([
        { method: "get", url: `${API_URL}/deployments/capabilities`, body: undefined },
        { method: "post", url: `${API_URL}${path}`, body },
      ]);
    }
  }
});

test("compatibility is checked again after a server changes between runs", async () => {
  let current = true;
  let created = 0;
  http.defaults.adapter = async (config) => {
    if (config.method === "post") created++;
    return { data: config.method === "get" ? (current ? { runContract: RUN_CONTRACT } : {}) : { createdDeployment: { id: "run" } },
      status: 200, statusText: "OK", headers: {}, config };
  };
  await createDeployment("design");
  current = false;
  await expect(createDeployment("design")).rejects.toThrow("This server does not support the required run version yet");
  expect(created).toBe(1);
});

test("an unavailable capabilities response refuses before creating a run", async () => {
  const requests: string[] = [];
  http.defaults.adapter = async (config) => {
    requests.push(config.method!);
    throw new Error("Unavailable");
  };
  await expect(createDeployment("design")).rejects.toThrow("Could not check server compatibility. Check your connection or session, then reload and try again.");
  expect(requests).toEqual(["get"]);
});

test("malformed contract values refuse starts without diagnosing a server update", async () => {
  for (const runContract of ["1", 1.5, {}, true]) {
    const requests: string[] = [];
    http.defaults.adapter = async config => {
      requests.push(config.method!);
      return { data: { runContract }, status: 200, statusText: "OK", headers: {}, config };
    };
    await expect(createDeployment("design")).rejects.toThrow("The server returned an invalid run compatibility response. Reload and try again.");
    expect(requests).toEqual(["get"]);
  }
});

test("session and server failures preserve their cause without claiming a version mismatch", async () => {
  for (const status of [401, 403, 503]) {
    const cause = { response: { status } };
    const get = spyOn(http, "get").mockRejectedValue(cause);
    try {
      let refusal: unknown;
      try { await requireRunCompatibility(); } catch (error) { refusal = error; }
      expect(refusal).toBeInstanceOf(Error);
      expect((refusal as Error).cause).toBe(cause);
      expect(errorMessage(refusal, "Fallback")).toBe("Could not check server compatibility. Check your connection or session, then reload and try again.");
    } finally { get.mockRestore(); }
  }
});
