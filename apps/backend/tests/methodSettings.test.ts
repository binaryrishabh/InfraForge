import { expect, test } from "bun:test";
import { methodSettingsRouter, unlinkMethod } from "../auth/methodSettings";
import { readAuthSettings } from "../auth/settings";
import { loginEnvironment } from "./loginMethodsFixture";

test("settings quota denial or outage stops every owner read and mutation", async () => {
  const settings = readAuthSettings({ ...loginEnvironment, AUTH_METHOD_SETTINGS_ENABLED: "true" });
  for (const mode of ["ip-denied", "user-denied", "outage"] as const) {
    for (const path of ["/methods", "/sessions", "/unlink", "/sessions/revoke", "/sessions/revoke-others"]) {
      let operations = 0;
      const operation = async () => { operations++; return []; };
      const db = { account: { findMany: operation }, session: { findMany: operation, deleteMany: operation },
        $transaction: operation };
      const auth = { api: { getSession: async () => ({ user: { id: "owner" }, session: { id: "current" } }),
        verifyPassword: operation } };
      const scopes: string[] = [];
      const quota = { allow: async (scope: string) => {
        scopes.push(scope);
        if (mode === "outage") throw Error("fixture-private-quota-error");
        return scope !== (mode === "ip-denied" ? "method-settings:ip" : "method-settings:user");
      } };
      const router = methodSettingsRouter(db as any, auth as any, quota, settings);
      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        const res = { locals: {}, setHeader: () => {}, statusCode: 200,
          status(code: number) { this.statusCode = code; return this; },
          json(body: unknown) { resolve({ status: this.statusCode, body }); },
        };
        const req = { method: ["/methods", "/sessions"].includes(path) ? "GET" : "POST", url: path,
          headers: {}, ip: "fixture-ip", body: { accountId: "owned", password: "fixture", sessionId: "owned" } };
        router(req as any, res as any, reject);
      });
      expect(response).toEqual({ status: mode === "outage" ? 503 : 429, body: { success: false } });
      expect(operations).toBe(0);
      expect(scopes).toContain("method-settings:ip");
      if (mode !== "outage") expect(scopes).toContain("method-settings:user");
    }
  }
});

test("disabled providers and empty password placeholders cannot be the last usable method", async () => {
  for (const fallback of [{ id: "fallback", providerId: "github" },
    { id: "fallback", providerId: "credential", password: null }]) {
    let deleted = false;
    const tx = { $queryRaw: async () => [{ id: "owner" }], session: { findFirst: async () => ({ id: "session" }) },
      account: { findMany: async () => [{ id: "selected", providerId: "google" }, fallback],
        deleteMany: async () => { deleted = true; } } };
    const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) };
    await expect(unlinkMethod(db as any, "owner", "session", "selected", ["google"]))
      .rejects.toThrow("Keep at least one usable login method");
    expect(deleted).toBe(false);
  }
});
