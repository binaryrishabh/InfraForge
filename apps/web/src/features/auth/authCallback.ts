// Capture bearer links before rendering (including analytics and third-party widgets).
export function readAuthCallback(browser: Pick<Window, "location" | "history">) {
  const url = new URL(browser.location.href);
  const signup = url.pathname === "/signup", reset = url.pathname === "/reset-password";
  const result = { emailProof: signup ? url.searchParams.get("emailProof") : null,
    token: reset ? url.searchParams.get("token") : null };
  if (signup || reset) browser.history.replaceState(browser.history.state, "", url.pathname);
  return result;
}
export const authCallback = typeof window === "undefined" ? { emailProof: null, token: null } : readAuthCallback(window);
