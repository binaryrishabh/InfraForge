// Fixed loopback origins, no credentials, redirects or configurable remote URL.
// The opt-in Compose override exposes the worker probe on loopback only.
export async function assertVerifierProductionResponsive(request = fetch) {
  await Promise.all(["http://127.0.0.1:3000/health/live", "http://127.0.0.1:3000/health/ready",
    "http://127.0.0.1:3002/health/ready"].map(async url => {
    const began = performance.now();
    const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    if (!response.ok || performance.now() - began >= 3000) throw Error("Production responsiveness unavailable");
  }));
}
