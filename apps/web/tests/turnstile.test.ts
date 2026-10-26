import { expect, test } from "bun:test";
import { mountTurnstile, type Turnstile } from "../src/features/auth/turnstileWidget";
import { obtainTurnstileToken } from "../src/features/auth/turnstileToken";

test("disabled Turnstile never loads a script or registers a provider", async () => {
  let loads = 0;
  mountTurnstile({} as HTMLElement, null, "signup", () => {}, async () => { loads++; throw Error(); })();
  expect(loads).toBe(0);
  await expect(obtainTurnstileToken("signup")).rejects.toThrow("not ready");
});
test("widget supplies one-use tokens for the matching action, invalidates failures and cleans up", async () => {
  for (const action of ["signup", "password_reset"] as const) {
    let options: Parameters<Turnstile["render"]>[1] | undefined;
    let resets = 0, removes = 0;
    const api: Turnstile = { render: (_, value) => { options = value; return "widget"; },
      reset: () => { resets++; }, remove: () => { removes++; } };
    const dispose = mountTurnstile({} as HTMLElement, "public-key", action, () => {}, async () => api);
    await Promise.resolve();
    expect(options?.action).toBe(action);
    expect(options?.sitekey).toBe("public-key");
    await expect(obtainTurnstileToken(action)).rejects.toThrow("Complete");
    options!.callback("fresh-token");
    await expect(obtainTurnstileToken(action === "signup" ? "password_reset" : "signup")).rejects.toThrow("Complete");
    expect(await obtainTurnstileToken(action)).toBe("fresh-token");
    expect(resets).toBe(1);
    await expect(obtainTurnstileToken(action)).rejects.toThrow("Complete");
    for (const callback of ["expired-callback", "error-callback", "timeout-callback"] as const) {
      options!.callback("old-token"); options![callback]();
      await expect(obtainTurnstileToken(action)).rejects.toThrow("Complete");
    }
    dispose();
    expect(removes).toBe(1);
    await expect(obtainTurnstileToken(action)).rejects.toThrow("not ready");
  }
});
test("leaving a page while the script loads never mounts a late widget", async () => {
  let resolve!: (api: Turnstile) => void, renders = 0;
  const dispose = mountTurnstile({} as HTMLElement, "key", "signup", () => {}, () => new Promise(done => { resolve = done; }));
  dispose();
  resolve({ render: () => { renders++; return "id"; }, reset: () => {}, remove: () => {} });
  await Promise.resolve();
  expect(renders).toBe(0);
});
test("script failures give an actionable status and cannot supply tokens", async () => {
  const messages: string[] = [];
  const dispose = mountTurnstile({} as HTMLElement, "key", "signup", value => messages.push(value), async () => { throw Error("offline"); });
  await Promise.resolve(); await Promise.resolve();
  expect(messages).toEqual(["Security check is unavailable. Reload to try again."]);
  await expect(obtainTurnstileToken("signup")).rejects.toThrow("Complete");
  dispose();
});
