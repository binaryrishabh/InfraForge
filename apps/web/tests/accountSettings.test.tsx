import { afterEach, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { http } from "../src/client/httpClient";
import { activeSessions, deviceName, loginMethods } from "../src/features/settings/accountSettings.api";
import { SignInMethodsSection, YourDataSection } from "../src/features/settings/AccountSections";

afterEach(() => { (http.get as unknown as { mockRestore?: () => void }).mockRestore?.(); });

test("sign-in methods report a switched-off deployment as unavailable, not as an error", async () => {
  spyOn(http, "get").mockRejectedValue({ response: { status: 404 } });
  expect(await loginMethods()).toBeNull();
  spyOn(http, "get").mockRejectedValue({ response: { status: 500 } });
  await expect(loginMethods()).rejects.toBeDefined();
});
test("sessions follow every page", async () => {
  const s = (id: string) => ({ id, createdAt: "2026-10-27T00:00:00Z", expiresAt: "2026-11-27T00:00:00Z", ipAddress: null, userAgent: null, current: id === "a" });
  const get = spyOn(http, "get")
    .mockResolvedValueOnce({ data: { sessions: [s("a")], next: "a" } } as never)
    .mockResolvedValueOnce({ data: { sessions: [s("b")], next: null } } as never);
  expect((await activeSessions()).map((x) => x.id)).toEqual(["a", "b"]);
  expect(get.mock.calls[1]![1]).toEqual({ params: { after: "a" } });
});
test("devices read as browser and system, never the raw user agent", () => {
  expect(deviceName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/140.0 Safari/537.36")).toBe("Chrome on Windows");
  expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Version/18.0 Safari/604.1")).toBe("Safari on iOS");
  expect(deviceName(null)).toBe("Unknown device");
});
test("settings offer data download and a guarded account deletion", () => {
  const html = renderToStaticMarkup(<MemoryRouter><SignInMethodsSection /><YourDataSection /></MemoryRouter>);
  expect(html).toContain("Sign-in methods"); expect(html).toContain("Loading");
  expect(html).toContain("Download your data"); expect(html).toContain("Delete account");
});
