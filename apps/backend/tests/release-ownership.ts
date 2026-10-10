// Bound into disposable rehearsal containers only; never shipped in the image.
import { Client } from "pg";
import Redis from "ioredis";
import WebSocket from "ws";
import { makeSignature } from "better-auth/crypto";
import { RESOURCE_TYPES } from "@infraforge/domain/resource";
import { auth } from "../auth/auth";
import { prisma } from "../lib/prisma";
import { collectEvidence } from "../cutover/evidence";

if (!["owned-local", "verified-neon"].includes(process.env.RELEASE_REHEARSAL ?? "")) throw new Error("Disposable rehearsal authorization required");
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const context = await auth.$context;
const users: string[] = [];
const designs: string[] = [];
const runs: string[] = [];
const observer = new Redis({ host: "redis" });
const controls: string[] = [];
observer.on("message", (_channel, message) => controls.push(message));
await observer.subscribe("simulator:control");
const origin = "https://app.example.invalid";
const request = async (path: string, cookie: string, method = "GET", body?: unknown, expected = 404) => {
  const response = await fetch(`http://api:3000/api${path}`, { method, signal: AbortSignal.timeout(5000),
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status !== expected) throw new Error(`Ownership check failed: ${method} ${path}, status ${response.status}`);
  return await response.json() as { allInfrastructure?: unknown[]; deployments?: unknown[] };
};
const deniedSocket = (cookie: string, id: string) => new Promise<void>((resolve, reject) => {
  const socket = new WebSocket("ws://ws-server:3001", { headers: { Origin: origin, Cookie: cookie } });
  const timer = setTimeout(() => { socket.terminate(); reject(new Error("Ownership WS timed out")); }, 5000);
  socket.on("error", () => { clearTimeout(timer); reject(new Error("Ownership WS failed to connect")); });
  socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", deploymentId: id })));
  socket.on("close", (code) => { clearTimeout(timer); if (code === 1008) resolve(); else reject(new Error("Unauthorized WS subscription was not denied")); });
});
try {
  const legacy = (await db.query(`SELECT id FROM "Infrastructure" WHERE "userId"='test-user' AND "ownerId" IS NULL`)).rows;
  if (legacy.length !== 28) throw new Error("Historical quarantine count differs from the accepted cutover baseline");
  const cookies: string[] = [];
  for (let i = 0; i < 2; i++) {
    const user = await context.internalAdapter.createUser({ name: "Rehearsal fixture", email: `${crypto.randomUUID()}@infraforge.test`, emailVerified: true }, { method: "fixture" });
    users.push(user.id);
    const session = await context.internalAdapter.createSession(user.id);
    if (!session) throw new Error("Database-backed fixture session failed");
    const signature = await makeSignature(session.token, process.env.BETTER_AUTH_SECRET!);
    cookies.push(`${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`);
    const list = await request("/infrastructure", cookies[i]!, "GET", undefined, 200);
    if (list.allInfrastructure?.length !== 0) throw new Error("New user can see a historical design");
    const id = crypto.randomUUID(); designs.push(id);
    await db.query(`INSERT INTO "Infrastructure" (id,name,layout,"userId","ownerId","updatedAt") VALUES ($1,'Rehearsal fixture','{"resources":[],"connectionLines":[]}',$2,$2,now())`, [id, user.id]);
    const run = crypto.randomUUID(); runs.push(run);
    await db.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,"updatedAt") VALUES ($1,$2,'completed',now())`, [run, id]);
  }
  const before = await collectEvidence(db);
  for (let i = 0; i < 2; i++) {
    const other = 1 - i;
    const cookie = cookies[i]!;
    const id = designs[other]!;
    const run = runs[other]!;
    for (const path of [`/infrastructure/${id}`, `/infrastructure/${id}/deployments`, `/deployments/${run}`]) await request(path, cookie);
    await request(`/infrastructure/${id}`, cookie, "PUT", { name: "Unauthorized" });
    await request(`/infrastructure/${id}`, cookie, "DELETE");
    await request("/deployments", cookie, "POST", { infrastructureId: id });
    const commands = { chaos: { type: "crash", resourceId: "vm" }, load: { targetLoadFraction: 1 },
      "scale-vertical": { resourceId: "vm", skuId: "m5.xlarge" }, "scale-pool": { lbId: "lb", delta: 1 },
      speed: { speed: 60 }, "sync-topology": { resources: [{ id: "vm", type: RESOURCE_TYPES.VirtualMachine, x: 0, y: 0 }], connectionLines: [], expectedRevision: 0 }, teardown: {} };
    for (const [action, body] of Object.entries(commands)) await request(`/deployments/${run}/${action}`, cookie, "POST", body);
    await deniedSocket(cookie, run);
    await request(`/infrastructure/${legacy[0].id}`, cookie);
    const oldRun = (await db.query('SELECT id FROM "Deployment" WHERE "infrastructureId"=$1 LIMIT 1', [legacy[0].id])).rows[0];
    if (oldRun) { await request(`/deployments/${oldRun.id}`, cookie); await deniedSocket(cookie, oldRun.id); }
  }
  await Bun.sleep(200);
  const after = await collectEvidence(db);
  if (JSON.stringify(before.contentHashes) !== JSON.stringify(after.contentHashes) || controls.length) throw new Error("Unauthorized access changed data or emitted a simulator control");
  console.log(JSON.stringify({ ownership: "PASS", realDatabaseSessions: 2, quarantinedDesigns: 28, unauthorizedControls: 0 }));
} finally {
  observer.disconnect();
  for (const id of runs) await db.query('DELETE FROM "Deployment" WHERE id=$1', [id]);
  for (const id of designs) await db.query('DELETE FROM "Infrastructure" WHERE id=$1', [id]);
  for (const id of users) await prisma.user.delete({ where: { id } });
  await Promise.allSettled([prisma.$disconnect(), db.end()]);
}
process.exit(0);
