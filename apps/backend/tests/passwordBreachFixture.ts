import { afterEach, beforeEach, spyOn } from "bun:test";
import { createHash } from "node:crypto";

// Exercise the real HIBP plugin without contacting an external service in tests.
export function mockPasswordBreachService() {
  const state = { compromised: "", unavailable: false, requests: [] as string[] };
  let mock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
  beforeEach(() => {
    state.compromised = ""; state.unavailable = false; state.requests = [];
    const original = globalThis.fetch;
    mock = spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.pwnedpasswords.com/range/")) return original(input, init);
      state.requests.push(url);
      if (state.unavailable) return new Response("Unavailable", { status: 503 });
      const hash = createHash("sha1").update(state.compromised).digest("hex").toUpperCase();
      return new Response(state.compromised && url.endsWith(hash.slice(0, 5)) ? `${hash.slice(5)}:12` : "00000000000000000000000000000000000:0");
    }) as typeof fetch);
  });
  afterEach(() => mock.mockRestore());
  return state;
}
