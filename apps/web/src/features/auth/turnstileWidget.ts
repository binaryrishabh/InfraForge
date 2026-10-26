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
  status: (message: string) => void, load = loadTurnstile) {
  if (!siteKey) return () => {};
  let disposed = false, token = "", id: string | undefined, api: Turnstile | undefined;
  const unregister = setTurnstileTokenProvider(async requested => {
    if (requested !== action || !token || !api || id === undefined) throw Error("Complete the security check");
    const fresh = token; token = ""; api.reset(id); status("Complete the security check before your next request.");
    return fresh;
  });
  void load().then(widget => {
    if (disposed) return;
    api = widget;
    const invalid = () => { token = ""; status("Complete the security check. If it cannot load, reload this page."); };
    id = widget.render(element, { sitekey: siteKey, action, "response-field": false,
      callback: value => { token = value; status("Security check complete."); },
      "expired-callback": invalid, "error-callback": invalid, "timeout-callback": invalid });
  }).catch(() => { if (!disposed) status("Security check is unavailable. Reload to try again."); });
  return () => { disposed = true; token = ""; unregister(); if (api && id !== undefined) api.remove(id); };
}
