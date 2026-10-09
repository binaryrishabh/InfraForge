import { expect } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { connect as connectTcp } from "node:net";
import { Queue } from "bullmq";
import WebSocket from "ws";
import { LocalHarness, until } from "./localHarness";
import { SessionFixtures } from "./sessionFixtures";
import { layout } from "./scenario";
import { recoverOwnership } from "../../auth/recoverOwnership";
import { captureRunInputs } from "../../deployments/runInputs";

export async function checkUserIsolation(harness: LocalHarness, fixtures: SessionFixtures, designId: string, runId: string) {
  const aliceCookie = harness.cookie;
  const alice = await harness.request("/auth/get-session");
  const bob = await fixtures.create();
  const context = await fixtures.auth.$context;
  expect(context.authCookies.sessionToken.attributes).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", secure: false });
  const designIds: string[] = [];
  const sockets: WebSocket[] = [];
  const controls: string[] = [];
  const phase = (name: string) => console.info(`Security phase: ${name}`);
  const observer = harness.redis.duplicate();
  observer.on("message", (_channel, event) => controls.push(event));
  await observer.subscribe("simulator:control");
  const connect = async (cookie: string) => {
    const socket = new WebSocket("ws://localhost:3001", { headers: { Cookie: cookie, Origin: harness.origin } });
    sockets.push(socket);
    let failure: Error | undefined;
    socket.once("error", (error) => { failure = error; });
    await until(async () => { if (failure) throw failure; return socket.readyState === WebSocket.OPEN || undefined; }, "authenticated socket open", 5000);
    return socket;
  };
  const rejectedUpgrade = (cookie: string, origin?: string) => new Promise<number>((resolve, reject) => {
    // Bun's ws client omits unexpected-response; read the actual HTTP handshake.
    const socket = connectTcp({ host: "localhost", port: 3001 });
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Upgrade response timed out")); }, 5000);
    socket.once("close", () => { clearTimeout(timeout); reject(new Error("Upgrade closed without a complete HTTP response")); });
    socket.once("error", reject);
    socket.once("connect", () => socket.write([
      "GET / HTTP/1.1", "Host: localhost:3001", "Connection: Upgrade", "Upgrade: websocket",
      "Sec-WebSocket-Version: 13", `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      `Cookie: ${cookie}`, ...(origin ? [`Origin: ${origin}`] : []), "", "",
    ].join("\r\n")));
    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString();
      if (!response.includes("\r\n\r\n")) return;
      socket.destroy();
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]);
      if (!status || status === 101) reject(new Error("Unauthorized upgrade accepted"));
      else resolve(status);
    });
  });
  const deniedSubscription = async (cookie: string, id: string) => {
    const socket = await connect(cookie);
    let closed: number | undefined;
    socket.once("close", (code) => { closed = code; });
    socket.send(JSON.stringify({ type: "subscribe", deploymentId: id }));
    expect(await until(async () => closed, "unauthorized subscription close", 5000)).toBe(1008);
  };
  try {
    phase("cross-user HTTP and CSRF");
    const beforeDesign = (await harness.sql.query('SELECT * FROM "Infrastructure" WHERE id = $1', [designId])).rows[0];
    const beforeRun = (await harness.sql.query('SELECT * FROM "Deployment" WHERE id = $1', [runId])).rows[0];
    const outboxCount = (await harness.sql.query('SELECT count(*) AS count FROM "Outbox"')).rows[0].count;
    harness.cookie = bob.cookie;
    expect((await harness.request("/auth/get-session")).user.id).toBe(bob.user.id);
    expect((await harness.request("/infrastructure")).allInfrastructure).toEqual([]);
    expect((await harness.request("/deployments/live")).deployments).toEqual([]);
    for (const path of [`/infrastructure/${designId}`, `/infrastructure/${designId}/deployments`, `/deployments/${runId}`]) {
      await harness.request(path, undefined, "GET", 404);
    }
    await harness.request(`/infrastructure/${designId}`, { name: "Stolen", userId: bob.user.id }, "PUT", 404);
    await harness.request(`/infrastructure/${designId}`, undefined, "DELETE", 404);
    await harness.request("/deployments", { infrastructureId: designId, userId: bob.user.id }, "POST", 404);
    const commands = { chaos: { type: "crash", resourceId: "vm-a" }, load: { targetLoadFraction: 1 },
      "scale-vertical": { resourceId: "vm-a", skuId: "m5.xlarge" }, "scale-pool": { lbId: "lb", delta: 1 },
      speed: { speed: 60 }, "sync-topology": { ...layout, expectedRevision: 0 }, teardown: {} };
    for (const [action, body] of Object.entries(commands)) await harness.request(`/deployments/${runId}/${action}`, body, "POST", 404);
    harness.cookie = "";
    await harness.request(`/deployments/${runId}/speed`, { speed: 60 }, "POST", 401);
    harness.cookie = aliceCookie;
    const forbiddenSignOut = await fetch(`${harness.api}/auth/sign-out`, { method: "POST",
      headers: { Cookie: aliceCookie, Origin: "https://attacker.test", "Content-Type": "application/json" }, body: "{}" });
    expect(forbiddenSignOut.status).toBe(403);
    expect((await harness.request("/auth/get-session")).user.id).toBe(alice.user.id);
    for (const origin of ["https://attacker.test", "null", undefined]) {
      const response = await fetch(`${harness.api}/deployments/${runId}/speed`, { method: "POST",
        headers: { Cookie: aliceCookie, "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: '{"speed":60}' });
      expect(response.status).toBe(403);
    }
    await Bun.sleep(150);
    expect(controls).toHaveLength(0);
    expect((await harness.sql.query('SELECT * FROM "Infrastructure" WHERE id = $1', [designId])).rows[0]).toEqual(beforeDesign);
    expect((await harness.sql.query('SELECT * FROM "Deployment" WHERE id = $1', [runId])).rows[0]).toEqual(beforeRun);
    expect((await harness.sql.query('SELECT count(*) AS count FROM "Outbox"')).rows[0].count).toBe(outboxCount);

    harness.cookie = bob.cookie;
    const bobDesign = (await harness.request("/infrastructure", { name: "Bob design", layout, userId: alice.user.id, ownerId: alice.user.id }, "POST", 201)).createdInfrastructure;
    designIds.push(bobDesign.id);
    expect(bobDesign.userId).toBe(bob.user.id);
    expect(bobDesign.ownerId).toBe(bob.user.id);
    const insertRun = async (parent: string, status: string) => {
      const id = randomUUID();
      const input = captureRunInputs(layout);
      await harness.sql.query(`INSERT INTO "Deployment" (id,"infrastructureId",status,seed,"workloadProfile","runInputs","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,now())`, [id, parent, status, input.seed, JSON.stringify(input.workloadProfile), JSON.stringify(input)]);
      return id;
    };
    const bobRun = await insertRun(bobDesign.id, "completed");
    phase("reverse ownership and WebSocket denial");
    harness.cookie = aliceCookie;
    await harness.request(`/infrastructure/${bobDesign.id}`, undefined, "GET", 404);
    await harness.request(`/infrastructure/${bobDesign.id}`, { name: "Stolen" }, "PUT", 404);
    await harness.request(`/infrastructure/${bobDesign.id}`, undefined, "DELETE", 404);
    await harness.request(`/deployments/${bobRun}`, undefined, "GET", 404);
    for (const [action, body] of Object.entries(commands)) await harness.request(`/deployments/${bobRun}/${action}`, body, "POST", 404);
    await deniedSubscription(aliceCookie, bobRun);
    await harness.request("/infrastructure", undefined, "DELETE", 404);
    await harness.request("/test-deploy", {}, "POST", 404);

    const legacyId = randomUUID(); designIds.push(legacyId);
    phase("legacy quarantine and worker");
    await harness.sql.query(`INSERT INTO "Infrastructure" (id,"userId",name,layout,"updatedAt") VALUES ($1,'test-user','Quarantined',$2,now())`, [legacyId, JSON.stringify(layout)]);
    const legacyRun = await insertRun(legacyId, "pending");
    for (const cookie of [aliceCookie, bob.cookie]) {
      harness.cookie = cookie;
      expect((await harness.request("/infrastructure")).allInfrastructure.some((design: { id: string }) => design.id === legacyId)).toBe(false);
      await harness.request(`/infrastructure/${legacyId}`, undefined, "GET", 404);
      await harness.request("/deployments", { infrastructureId: legacyId }, "POST", 404);
      await harness.request(`/deployments/${legacyRun}`, undefined, "GET", 404);
      await harness.request(`/deployments/${legacyRun}/speed`, { speed: 1 }, "POST", 404);
      await deniedSubscription(cookie, legacyRun);
    }
    const recovery = { designId: legacyId, userId: bob.user.id, expectedLegacyUserId: "test-user", evidence: "disposable-fixture-owner-proof", apply: false };
    const rejectedRecovery = async (input: typeof recovery, message: string) => {
      // Await I/O normally; Bun's native rejects matcher can stall pg BEGIN replies.
      const error = await recoverOwnership(fixtures.prisma, input).then(() => null, (failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(message);
    };
    await rejectedRecovery(recovery, "active");
    await expect(harness.sql.query('UPDATE "Infrastructure" SET "ownerId"=$1 WHERE id=$2', [bob.user.id, legacyId])).rejects.toThrow("no active runs");
    const queue = new Queue("deployments", { connection: { host: "127.0.0.1", port: harness.settings.redisPort } });
    try {
      await queue.add("deployment-created", { deploymentId: legacyRun }, { jobId: randomUUID() });
      await until(async () => (await fixtures.prisma.deployment.findUnique({ where: { id: legacyRun } }))?.status === "failed" || undefined, "quarantined worker job");
    } finally { await queue.close(); }
    const quarantined = await fixtures.prisma.deployment.findUniqueOrThrow({ where: { id: legacyRun } });
    expect(quarantined.runtimeActive).toBe(false);
    expect(quarantined.stages).toEqual([]);
    expect(JSON.stringify(quarantined.timeline)).toContain("ownership is unverified");
    expect((await recoverOwnership(fixtures.prisma, recovery)).applied).toBe(false);
    expect((await harness.sql.query('SELECT "ownerId" FROM "Infrastructure" WHERE id=$1',[legacyId])).rows[0].ownerId).toBeNull();
    await rejectedRecovery({ ...recovery, expectedLegacyUserId: "wrong", apply: true }, "historical owner marker");
    await fixtures.prisma.user.update({ where: { id: bob.user.id }, data: { emailVerified: false } });
    await rejectedRecovery({ ...recovery, apply: true }, "verified email");
    expect((await harness.sql.query('SELECT "ownerId" FROM "Infrastructure" WHERE id=$1', [legacyId])).rows[0].ownerId).toBeNull();
    await fixtures.prisma.user.update({ where: { id: bob.user.id }, data: { emailVerified: true } });
    expect((await recoverOwnership(fixtures.prisma, { ...recovery, apply: true })).applied).toBe(true);
    expect((await harness.sql.query('SELECT "userId" FROM "Infrastructure" WHERE id=$1',[legacyId])).rows[0].userId).toBe("test-user");
    await rejectedRecovery({ ...recovery, apply: true }, "already assigned");
    await expect(harness.sql.query('UPDATE "Infrastructure" SET "ownerId"=$1 WHERE id=$2', [alice.user.id, legacyId])).rejects.toThrow("unassigned design");

    phase("upgrade rejection: missing session");
    expect(await rejectedUpgrade("", harness.origin)).toBe(401);
    phase("upgrade rejection: origin");
    expect(await rejectedUpgrade(aliceCookie, "https://attacker.test")).toBe(403);
    expect(await rejectedUpgrade(aliceCookie)).toBe(403);
    expect(await rejectedUpgrade(aliceCookie + "tampered", harness.origin)).toBe(401);
    const subscriberCount = await harness.redis.pubsub("NUMSUB", `deployment:${runId}:updates`);
    await deniedSubscription(bob.cookie, runId);
    expect(await harness.redis.pubsub("NUMSUB", `deployment:${runId}:updates`)).toEqual(subscriberCount);

    for (const mode of ["expired", "revoked", "sign-out"]) {
      phase(mode);
      const session = await fixtures.sessionFor(alice.user.id);
      const socket = await connect(session.cookie);
      socket.send(JSON.stringify({ type: "subscribe", deploymentId: runId }));
      await until(async () => Number((await harness.redis.pubsub("NUMSUB", `deployment:${runId}:updates`) as Array<string | number>)[1]) > Number((subscriberCount as Array<string | number>)[1]) || undefined, "session fixture subscription");
      const messages: unknown[] = []; socket.on("message", (message) => messages.push(JSON.parse(message.toString())));
      let closed: number | undefined;
      socket.once("close", (code) => { closed = code; });
      if (mode === "expired") await fixtures.prisma.session.update({ where: { id: session.session.id }, data: { expiresAt: new Date(0) } });
      else if (mode === "revoked") await fixtures.prisma.session.delete({ where: { id: session.session.id } });
      else {
        harness.cookie = session.cookie;
        await harness.request("/auth/sign-out", {});
        expect(await fixtures.prisma.session.findUnique({ where: { id: session.session.id } })).toBeNull();
      }
      await harness.redis.publish(`deployment:${runId}:updates`, JSON.stringify({ private: "must-not-deliver" }));
      expect(await until(async () => closed, `${mode} session close`, 5000)).toBe(1008);
      expect(messages).toEqual([]);
      expect(await rejectedUpgrade(session.cookie, harness.origin)).toBe(401);
      harness.cookie = session.cookie;
      await harness.request(`/deployments/${runId}/speed`, { speed: 60 }, "POST", 401);
    }
    harness.cookie = aliceCookie;
    expect((await harness.request(`/deployments/${runId}`)).deployment.id).toBe(runId);
    expect(controls).toHaveLength(0);
    return { databaseSessions: true, crossUserCommandsBlocked: Object.keys(commands).length,
      crossUserMutation: false, unauthorizedControlEvents: controls.length, expiryRevocationAndSignOut: true, ownerlessWorkerRejected: true,
      legacyQuarantineAndDryRunRecovery: true, untrustedOriginsRejected: true };
  } finally {
    harness.cookie = aliceCookie;
    for (const socket of sockets) socket.terminate();
    observer.disconnect();
    await harness.sql.query('DELETE FROM "Infrastructure" WHERE id = ANY($1::text[])', [designIds]);
  }
}
