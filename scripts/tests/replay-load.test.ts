import { expect, test } from "bun:test";
import { parseOptions, percentile, runCohort, submissionFor } from "../load/replay-load";
import { checkSubmission } from "../../apps/backend/browserRuns/submission";

test("load CLI requires a rehearsal target and rejects malformed cohorts", () => {
  expect(() => parseOptions(["--api", "http://localhost/api", "--origin", "http://localhost"])).toThrow("required");
  for (const users of ["0", "-1", "1.5", "10,", "no"]) {
    expect(() => parseOptions(["--rehearsal", "--api", "http://localhost/api", "--origin", "http://localhost", "--users", users])).toThrow();
  }
  expect(parseOptions(["--rehearsal", "--api", "http://localhost/api/", "--origin", "http://localhost"]).users).toEqual([10, 25, 50]);
  expect(percentile([], 0.95)).toBeNull();
  expect(percentile([30, 10, 20], 0.5)).toBe(20);
  expect(percentile([30, 10, 20], 0.95)).toBe(30);
});

test("submission mix spans short challenges, 120-600 second runs and 1-3 ordered actions", () => {
  const submissions = Array.from({ length: 25 }, (_, i) => submissionFor(i));
  const freeform = submissions.filter((s) => s.actions.length);
  expect(new Set(freeform.map((s) => s.stopAtSecond))).toEqual(new Set([120, 240, 360, 480, 600]));
  expect(new Set(freeform.map((s) => s.actions.length))).toEqual(new Set([1, 2, 3]));
  expect(submissions.filter((s) => s.actions.length === 0).every((s) => s.stopAtSecond === 60)).toBe(true);
  for (const submission of freeform) {
    expect<unknown>(checkSubmission(submission, { horizonSeconds: 900, challenge: false })).toEqual(submission);
    expect(submission.actions.every((a, i) => a.atSecond > (submission.actions[i - 1]?.atSecond ?? 0) && a.atSecond < submission.stopAtSecond)).toBe(true);
  }
});

test("HTTP driver isolates cookies, saves both design kinds, waits for browser and retries admission", async () => {
  let signups = 0;
  let saves = 0;
  let attempts = 0;
  let creations = 0;
  const runs = new Map<string, { cookie: string; browser: boolean; submitted: boolean; polls: number; tries: number }>();
  const submissions: { stopAtSecond: number; actions: unknown[] }[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/api/, "");
    expect(request.headers.get("Origin")).toBe("https://app.example.invalid");
    if (path === "/auth/sign-up/email") {
      const body = await request.json() as { username: string };
      expect(body.username).toMatch(/^Load_/);
      expect(request.headers.has("X-Forwarded-For")).toBe(false);
      return Response.json({}, { headers: { "Set-Cookie": `__Secure-better-auth.session_token=user-${++signups}; Path=/; HttpOnly; Secure` } });
    }
    const cookie = request.headers.get("Cookie")!;
    expect(cookie).toMatch(/^__Secure-better-auth.session_token=user-\d+$/);
    if (path.endsWith("/workspace")) return Response.json({ designId: "challenge-design" });
    if (path.startsWith("/infrastructure")) {
      const body = await request.json() as { layout: { resources: unknown[] } };
      expect(body.layout.resources).toHaveLength(5);
      saves++;
      return Response.json({ createdInfrastructure: { id: `design-${saves}` } });
    }
    if (path === "/deployments" || path.endsWith("/attempts")) {
      const body = await request.json() as { prediction: { answers: { busiest: string } }; workloadProfile: { targetThroughput: number } };
      if (path.endsWith("/attempts")) { attempts++; expect(body.prediction.answers.busiest).toBe("Virtual Machine"); }
      else {
        if (++creations === 1) return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
        expect(body.workloadProfile.targetThroughput).toBe(1_000_000);
      }
      const id = `run-${runs.size + 1}`;
      runs.set(id, { cookie, browser: false, submitted: false, polls: 0, tries: 0 });
      return Response.json({ createdDeployment: { id } }, { status: 201 });
    }
    const id = path.split("/")[2]!;
    const run = runs.get(id)!;
    expect(run.cookie).toBe(cookie);
    if (path.endsWith("/submit")) {
      expect(run.browser).toBe(true);
      expect([...runs.values()].every((r) => r.browser)).toBe(true);
      const body = await request.json() as { stopAtSecond: number; actions: unknown[] };
      if (++run.tries === 1) return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
      run.submitted = true;
      run.polls = 0;
      submissions.push(body);
      return new Response(null, { status: 202 });
    }
    if (!run.submitted) {
      run.browser = ++run.polls > 1;
      return Response.json({ deployment: { status: run.browser ? "browser" : "pending" } });
    }
    return Response.json({ deployment: { status: ++run.polls < 3 ? "live" : "torn-down" } });
  } });
  try {
    const results = await runCohort({ api: `${server.url.origin}/api`, origin: "https://app.example.invalid", users: [4], pollMs: 5, timeoutMs: 5000, host: false }, 4);
    expect(signups).toBe(4);
    expect(saves).toBe(4);
    expect(attempts).toBe(1);
    expect(submissions).toHaveLength(4);
    expect(submissions.filter((s) => s.stopAtSecond === 60 && s.actions.length === 0)).toHaveLength(1);
    expect(results.reduce((sum, r) => sum + r.create429s, 0)).toBe(1);
    expect(results.every((r) => r.submit429s === 1 && r.failure === null && r.queueMs! >= 250 && r.replayMs! > 0 && r.status === "torn-down")).toBe(true);
  } finally { await server.stop(true); }
});

test("missed live observations remain unknown and preparation/replay failures remain visible", async () => {
  for (const mode of ["missed-live", "failed", "signup-without-session", "timeout"] as const) {
    let submitted = false;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/sign-up/email")) return Response.json({}, { headers: mode === "signup-without-session" ? {} : { "Set-Cookie": "better-auth.session_token=fixture; Path=/" } });
      if (path.endsWith("/workspace")) return Response.json({ designId: "design" });
      if (path.includes("/infrastructure/")) return Response.json({});
      if (path.endsWith("/attempts")) return Response.json({ createdDeployment: { id: "run" } });
      if (path.endsWith("/submit")) { submitted = true; return new Response(null, { status: 202 }); }
      return Response.json({ deployment: { status: !submitted ? "browser" : mode === "failed" ? "failed" : mode === "timeout" ? "pending" : "torn-down" } });
    } });
    try {
      const [result] = await runCohort({ api: `${server.url.origin}/api`, origin: "http://localhost", users: [1], pollMs: 5, timeoutMs: 100, host: false }, 1);
      expect(result!.queueMs).toBeNull();
      expect(result!.replayMs).toBeNull();
      if (mode === "missed-live") { expect(result!.failure).toBeNull(); expect(result!.timingNote).toContain("unknown"); expect(result!.totalMs).not.toBeNull(); }
      else expect(result!.failure).not.toBeNull();
      if (mode === "signup-without-session") expect(submitted).toBe(false);
    } finally { await server.stop(true); }
  }
});
