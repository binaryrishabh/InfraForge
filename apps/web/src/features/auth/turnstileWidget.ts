import { setTurnstileTokenProvider, type TurnstileAction } from "./turnstileToken";

type WidgetOptions = { sitekey: string; action: TurnstileAction; callback: (token: string) => void;
  "expired-callback": () => void; "error-callback": () => void; "timeout-callback": () => void; "response-field": false };
export interface Turnstile { render: (element: HTMLElement, options: WidgetOptions) => string;
  reset: (id: string) => void; remove: (id: string) => void }
declare global { interface Window { turnstile?: Turnstile } }
let loading: Promise<Turnstile> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    const failed = () => { script.remove(); loading = undefined; reject(Error("Security check is unavailable. Reload to try again.")); };
    const timer = setTimeout(failed, 15000);
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => { clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else failed(); };
    script.onerror = () => { clearTimeout(timer); failed(); };
    document.head.appendChild(script);
  });
  return loading;
}
export function mountTurnstile(element: HTMLElement, siteKey: string | null, action: TurnstileAction,
  status: (message: string) => void, load = loadTurnstile, waitMs = 15000) {
  if (!siteKey) return () => {};
  let disposed = false, token = "", id: string | undefined, api: Turnstile | undefined;
  let waiters: Array<(value: string) => void> = [];
  // A submit waits for the widget's (usually invisible) check instead of failing at once,
  // so a quick click or a second request never shows a spurious "security check" error.
  const nextToken = () => token ? Promise.resolve(token) : new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { waiters = waiters.filter(w => w !== done); reject(Error("Complete the security check")); }, waitMs);
    const done = (value: string) => { clearTimeout(timer); resolve(value); };
    waiters.push(done);
  });
  const unregister = setTurnstileTokenProvider(async requested => {
    if (requested !== action || disposed) throw Error("Complete the security check");
    const fresh = await nextToken();
    token = ""; if (api && id !== undefined) api.reset(id);
    return fresh;
  });
  void load().then(widget => {
    if (disposed) return;
    api = widget;
    const invalid = () => { token = ""; status("The security check did not complete. If it keeps failing, reload this page."); };
    id = widget.render(element, { sitekey: siteKey, action, "response-field": false,
      callback: value => { token = value; status(""); const ready = waiters; waiters = []; ready.forEach(w => w(value)); },
      "expired-callback": () => { token = ""; }, "error-callback": invalid, "timeout-callback": invalid });
  }).catch(() => { if (!disposed) status("The security check could not load. Reload to try again."); });
  return () => { disposed = true; token = ""; unregister(); if (api && id !== undefined) api.remove(id); };
}
