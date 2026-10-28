/**
 * Run on the AWS rehearsal host against an already-running disposable stack:
 * bun --no-env-file scripts/load/replay-load.ts --rehearsal --api http://127.0.0.1:3000/api --origin https://app.example.invalid --users 10,25,50 --host
 * scripts/release/rehearse.ts shows the production-like API/worker/DB stack.
 * Supply its trusted app Origin and reachable API URL; never target production.
 * Public email signup must issue sessions (as in sessionFixtures.createCredential).
 * Mail proof / CAPTCHA requirements are reported as failures, never bypassed.
 * Creates disposable accounts, designs and records; discard the rehearsal DB afterwards.
 * Browser execution is omitted: prepared browser runs submit together to stress replay.
 * Timings are client polling observations, approximate to --poll-ms plus HTTP latency.
 * --host samples this machine, so run beside the stack for meaningful host figures.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const help = `Replay load (disposable rehearsal stack only)
--rehearsal          Required acknowledgement of a non-production target
--api URL            API base including /api
--origin URL         Trusted app origin used for signup and authenticated requests
--users 10,25,50      Sequential cohorts, users parallel within each (default 10,25,50)
--poll-ms 500         Status polling interval
--timeout-seconds 1200  Deadline for each preparation/replay phase
--host               Sample local Linux /proc CPU and memory
--help               Show usage without making requests`;

async function readString(response: Response, key: string, container?: string): Promise<string> {
  let value: unknown = await response.json();
  if (container && value && typeof value === "object") value = (value as Record<string, unknown>)[container];
  const field = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  if (typeof field !== "string" || !field) throw new Error(`API response missing ${container ? container + "." : ""}${key}`);
  return field;
}

type Options = { api: string; origin: string; users: number[]; pollMs: number; timeoutMs: number; host: boolean };
type Submission = { stopAtSecond: number; actions: { atSecond: number; request:
  { kind: "load"; parameters: { targetLoadFraction: number } } |
  { kind: "chaos"; parameters: { type: "crash"; resourceId: string } } }[] };
type Result = { user: number; kind: "challenge" | "freeform"; deploymentId: string | null; stopAtSecond: number;
  actions: number; create429s: number; submit429s: number; queueMs: number | null; replayMs: number | null;
  totalMs: number | null; status: string; failure: string | null; timingNote: string | null };
type Prepared = { result: Result; cookie: string; submission: Submission };

export function parseOptions(args: string[]): Options {
  const options: Options = { api: "", origin: "", users: [10, 25, 50], pollMs: 500, timeoutMs: 1_200_000, host: false };
  let rehearsal = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--host") { options.host = true; continue; }
    if (flag === "--rehearsal") { rehearsal = true; continue; }
    if (!["--api", "--origin", "--users", "--poll-ms", "--timeout-seconds"].includes(flag!)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--api" || flag === "--origin") {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`Invalid ${flag} URL`);
      if (flag === "--api") options.api = url.href.replace(/\/$/, "");
      else {
        if (url.pathname !== "/") throw new Error("--origin must contain only the app origin");
        options.origin = url.origin;
      }
    } else {
      const values = value.split(",").map(Number);
      if (values.some((n) => !Number.isSafeInteger(n) || n < 1)) throw new Error(`Invalid ${flag}`);
      if (flag === "--users") options.users = values;
      else {
        if (values.length !== 1) throw new Error(`Invalid ${flag}`);
        if (flag === "--poll-ms") options.pollMs = values[0]!;
        else options.timeoutMs = values[0]! * 1000;
      }
    }
  }
  if (!rehearsal || !options.api || !options.origin) throw new Error("--rehearsal, --api and --origin are required; use --help");
  return options;
}

// Same small DNS -> balanced app pair -> database shape as the HTTP integration fixture.
const resources = [
  { id: "dns", type: "DNS", x: 0, y: 0 },
  { id: "lb", type: "Load Balancer", x: 200, y: 0 },
  { id: "vm-a", type: "Virtual Machine", x: 400, y: 0, skuId: "m5.large" },
  { id: "vm-b", type: "Virtual Machine", x: 400, y: 200, skuId: "m5.large" },
  { id: "db", type: "Database", x: 600, y: 0, skuId: "db.m5.large", public: true },
];
const edges = [[0, 1, 443], [1, 2, 80], [1, 3, 80], [2, 4, 5432], [3, 4, 5432]];
const layout = { layoutVersion: 3, resources, connectionLines: edges.map(([a, b, port], i) => ({ id: `edge-${i}`,
  sourceId: resources[a!]!.id, targetId: resources[b!]!.id, sourceType: resources[a!]!.type, targetType: resources[b!]!.type, port })) };

export function submissionFor(index: number): Submission {
  if (index % 4 === 0) return { stopAtSecond: 60, actions: [] };
  const freeformIndex = index - Math.floor(index / 4) - 1;
  const stopAtSecond = 120 + (freeformIndex % 5) * 120;
  const count = 1 + freeformIndex % 3;
  return { stopAtSecond, actions: Array.from({ length: count }, (_, i) => ({
    atSecond: Math.floor(stopAtSecond * (i + 1) / (count + 1)),
    request: i === 1 ? { kind: "chaos", parameters: { type: "crash", resourceId: "vm-a" } }
      : { kind: "load", parameters: { targetLoadFraction: i === 0 ? 1.25 : 0.8 } },
  })) };
}

class Client {
  cookie = "";
  constructor(private options: Options) {}
  async request(path: string, deadline: number, method = "GET", body?: unknown) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`Deadline exceeded during ${method} ${path}`);
    // Do not print server bodies, cookies or credentials, including on auth failure.
    return fetch(this.options.api + path, { method, redirect: "error",
      headers: { "Content-Type": "application/json", Origin: this.options.origin, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(Math.ceil(Math.min(15_000, remaining))) });
  }
  async json(path: string, deadline: number, method = "GET", body?: unknown, on429?: () => void) {
    while (true) {
      const response = await this.request(path, deadline, method, body);
      if (response.status === 429) {
        on429?.();
        await response.body?.cancel();
        await this.retry(response, deadline);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`${method} ${path}: HTTP ${response.status}`); }
      return response;
    }
  }
  async retry(response: Response, deadline: number) {
    const header = response.headers.get("Retry-After");
    const delay = header === null ? 1000 : /^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    await this.pause(deadline, Math.max(250, Number.isFinite(delay) ? delay : 1000) + Math.random() * 250);
  }
  async pause(deadline: number, ms = this.options.pollMs) {
    if (performance.now() >= deadline) throw new Error("Phase deadline exceeded");
    await Bun.sleep(Math.min(ms, Math.max(1, deadline - performance.now())));
  }
  async status(id: string, deadline: number): Promise<string> {
    return readString(await this.json(`/deployments/${id}`, deadline), "status", "deployment");
  }
}

async function prepare(options: Options, result: Result, submission: Submission): Promise<Prepared> {
  const client = new Client(options);
  const deadline = performance.now() + options.timeoutMs;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const signup = await client.json("/auth/sign-up/email", deadline, "POST", { username: `Load_${suffix}`,
    name: "Rehearsal load user", email: `${suffix}@infraforge.test`, password: randomBytes(24).toString("base64url") + "Aa1!" });
  client.cookie = signup.headers.getSetCookie().filter((cookie) => /^(?:__Secure-)?better-auth\.session_token(?:\.\d+)?=/.test(cookie))
    .map((cookie) => cookie.split(";")[0]).join("; ");
  await signup.body?.cancel();
  if (!client.cookie) throw new Error("Signup issued no session; rehearsal must support public credential signup without mailbox proof/CAPTCHA");
  let infrastructureId: string;
  if (result.kind === "challenge") {
    infrastructureId = await readString(await client.json("/challenges/first-production-api/workspace", deadline, "POST", {}), "designId");
    await (await client.json(`/infrastructure/${infrastructureId}`, deadline, "PUT", { layout })).body?.cancel();
  } else {
    infrastructureId = await readString(await client.json("/infrastructure", deadline, "POST", { name: `Replay load ${suffix}`, layout }), "id", "createdInfrastructure");
  }
  const path = result.kind === "challenge" ? "/challenges/first-production-api/attempts" : "/deployments";
  const body = result.kind === "challenge" ? { infrastructureId,
    prediction: { answers: { health: "healthy", busiest: "Virtual Machine" }, reasoning: "Two app servers share the traffic." } }
    : { infrastructureId, workloadProfile: { targetThroughput: 1_000_000, throughputUnit: "per-hour",
      trafficShape: "steady", readWriteRatio: 0.8, payloadSize: "medium" } };
  const id = await readString(await client.json(path, deadline, "POST", body, () => result.create429s++), "id", "createdDeployment");
  result.deploymentId = id;
  while (true) {
    result.status = await client.status(id, deadline);
    if (result.status === "browser") break;
    if (["failed", "completed", "torn-down"].includes(result.status)) throw new Error(`Preparation ended with ${result.status}`);
    await client.pause(deadline);
  }
  return { result, cookie: client.cookie, submission };
}

async function replay(options: Options, prepared: Prepared) {
  const { result, submission } = prepared;
  const client = new Client(options);
  client.cookie = prepared.cookie;
  const submitted = performance.now();
  const deadline = submitted + options.timeoutMs;
  let live: number | null = null;
  try {
    await (await client.json(`/deployments/${result.deploymentId}/submit`, deadline, "POST", submission, () => result.submit429s++)).body?.cancel();
    while (true) {
      result.status = await client.status(result.deploymentId!, deadline);
      const now = performance.now();
      if (result.status === "live" && live === null) { live = now; result.queueMs = now - submitted; }
      if (["torn-down", "failed", "completed"].includes(result.status)) {
        result.totalMs = now - submitted;
        if (live !== null) result.replayMs = now - live;
        else result.timingNote = "live was not observed; queue/replay split unknown";
        if (result.status !== "torn-down") throw new Error(`Replay ended with ${result.status}`);
        break;
      }
      await client.pause(deadline);
    }
  } catch (error) { result.failure = error instanceof Error ? error.message : "Unknown replay failure"; }
}

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}
const seconds = (ms: number | null) => ms === null ? "unknown" : (ms / 1000).toFixed(3);

async function sampleHost(enabled: boolean) {
  const samples: { cpu: number; usedMiB: number }[] = [];
  let previous: { total: number; idle: number } | undefined;
  let failures = 0;
  let pending: Promise<void> | undefined;
  const sample = async () => {
    const [stat, memory] = await Promise.all([readFile("/proc/stat", "utf8"), readFile("/proc/meminfo", "utf8")]);
    // guest/guest_nice already belong to user/nice; count only the first eight fields.
    const ticks = stat.split("\n")[0]!.trim().split(/\s+/).slice(1, 9).map(Number);
    const current = { total: ticks.reduce((sum, n) => sum + n, 0), idle: ticks[3]! + ticks[4]! };
    const totalKiB = Number(/^MemTotal:\s+(\d+)/m.exec(memory)?.[1]);
    const availableKiB = Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1]);
    if (ticks.length !== 8 || !ticks.every(Number.isFinite) || !Number.isFinite(totalKiB + availableKiB)) throw new Error("Unreadable /proc counters");
    if (previous && current.total > previous.total) samples.push({
      cpu: 100 * (1 - (current.idle - previous.idle) / (current.total - previous.total)), usedMiB: (totalKiB - availableKiB) / 1024 });
    previous = current;
  };
  if (!enabled || process.platform !== "linux") {
    if (enabled) console.log("Host sampling skipped: /proc sampling requires Linux.");
    return async () => {};
  }
  try { await sample(); } catch { console.log("Host sampling unavailable: cannot read Linux /proc counters."); return async () => {}; }
  const timer = setInterval(() => {
    if (!pending) pending = sample().catch(() => { failures++; }).finally(() => { pending = undefined; });
  }, 1000);
  return async () => {
    clearInterval(timer);
    await pending;
    await sample().catch(() => { failures++; });
    console.log("Local host during replay cohort (all processes, memory = total - available):");
    console.table([{
      samples: samples.length, failedSamples: failures,
      cpuP50Percent: percentile(samples.map((s) => s.cpu), 0.5), cpuP95Percent: percentile(samples.map((s) => s.cpu), 0.95),
      cpuMaxPercent: percentile(samples.map((s) => s.cpu), 1), memoryP50MiB: percentile(samples.map((s) => s.usedMiB), 0.5),
      memoryP95MiB: percentile(samples.map((s) => s.usedMiB), 0.95), memoryMaxMiB: percentile(samples.map((s) => s.usedMiB), 1),
    }]);
  };
}

export async function runCohort(options: Options, users: number): Promise<Result[]> {
  const results: Result[] = Array.from({ length: users }, (_, index) => {
    const submission = submissionFor(index);
    return { user: index + 1, kind: index % 4 === 0 ? "challenge" : "freeform", deploymentId: null,
      stopAtSecond: submission.stopAtSecond, actions: submission.actions.length, create429s: 0, submit429s: 0,
      queueMs: null, replayMs: null, totalMs: null, status: "preparing", failure: null, timingNote: null };
  });
  console.log(`N=${users}: preparing sessions, saved designs and browser runs in parallel`);
  const prepared = await Promise.all(results.map(async (result, index) => {
    try { return await prepare(options, result, submissionFor(index)); }
    catch (error) { result.failure = error instanceof Error ? error.message : "Unknown preparation failure"; return null; }
  }));
  const ready = prepared.filter((p) => p !== null);
  console.log(`N=${users}: submitting ${ready.length} browser-ready runs together (no browser-time sleep)`);
  const stopSampling = await sampleHost(options.host);
  try {
    await Promise.all(ready.map(async (run) => { await replay(options, run); console.log(JSON.stringify({ N: users, ...run.result })); }));
    for (const result of results) {
      // Preparation failures have no replay callback to print their record.
      if (!ready.some((r) => r.result === result)) console.log(JSON.stringify({ N: users, ...result }));
    }
  } finally { await stopSampling(); }
  return results;
}

if (import.meta.main) {
  try {
    if (process.argv.includes("--help")) console.log(help);
    else {
      const options = parseOptions(process.argv.slice(2));
      const summary: Record<string, string | number>[] = [];
      let failures = 0;
      console.log("Queue = first submit attempt through observed live (includes 429 retries). Replay = observed live through torn-down. Unknown timings are excluded; measured counts shown.");
      for (const users of options.users) {
        const results = await runCohort(options, users);
        const failed = results.filter((r) => r.failure !== null).length;
        failures += failed;
        for (const metric of ["queueMs", "replayMs", "totalMs"] as const) {
          const values = results.filter((r) => r.status === "torn-down" && r.failure === null).map((r) => r[metric]).filter((v) => v !== null);
          summary.push({ N: users, success: users - failed, failures: failed, metric, measured: values.length,
            submit429s: results.reduce((sum, r) => sum + r.submit429s, 0),
            p50Seconds: seconds(percentile(values, 0.5)), p95Seconds: seconds(percentile(values, 0.95)), maxSeconds: seconds(percentile(values, 1)) });
        }
        console.table(summary.slice(-3));
      }
      console.log("Summary (successful runs only):");
      console.table(summary);
      process.exitCode = failures ? 1 : 0;
    }
  } catch (error) { console.error(error instanceof Error ? error.message : "Load test failed"); process.exitCode = 1; }
}
