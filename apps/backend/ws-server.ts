import { WebSocketServer } from "ws";
import http from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { auth, authSettings } from "./auth/auth";
import { prisma } from "./lib/prisma";
import { subscribeToDeployment } from "./infra/pubsub";
import { attachDeploymentSubscription, SUBSCRIPTION_MAX_BYTES } from "./infra/deploymentSubscriptions";
import { assertRuntimeSchema } from "./release/runtime";
import { createReadiness } from "./health/readiness";
import { config } from "./utils/config";
import { redis, commandRedis } from "./infra/redis";
import { configureHttpServer, createShutdown, shutdownOnSignals } from "./utils/lifecycle";
import { MAX_SOCKET_CLIENTS, startSocketHeartbeat } from "./utils/socketLifecycle";

await assertRuntimeSchema();
const readiness = createReadiness();
const server = http.createServer(async (req, res) => {
  if (lifecycle.isStopping()) { res.writeHead(503); res.end(); return; }
  if (req.url === "/health/live") { res.writeHead(200); res.end("ok"); return; }
  if (!["/", "/health", "/health/ready"].includes(req.url ?? "")) { res.writeHead(404); res.end(); return; }
  const result = await readiness.check();
  res.writeHead(result.success ? 200 : 503, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});
const authenticated = new WeakMap<http.IncomingMessage, { headers: Headers; userId: string }>();
let pendingAuthentications = 0;
// Bun 1.3.14 exposes a synthetic upgrade socket. Its ws verifier sends HTTP
// rejection responses correctly; writing to that socket cannot do so reliably.
const wss = new WebSocketServer({ server, maxPayload: SUBSCRIPTION_MAX_BYTES,
  verifyClient: async ({ req }, done) => {
    if (lifecycle.isStopping() || wss.clients.size + pendingAuthentications >= MAX_SOCKET_CLIENTS) {
      done(false, 503); return;
    }
    if (!["/", "/ws"].includes(req.url ?? "") || !req.headers.origin || !authSettings.origins.includes(req.headers.origin)) {
      done(false, 403); return;
    }
    pendingAuthentications++;
    try {
      const headers = fromNodeHeaders(req.headers);
      const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
      if (!session) { done(false, 401); return; }
      authenticated.set(req, { headers, userId: session.user.id });
      done(true);
    } catch { done(false, 503); }
    finally { pendingAuthentications--; }
  },
});

wss.on("connection", (socket, req) => {
  const identity = authenticated.get(req);
  if (!identity) { socket.close(1008); return; }
  const getSession = () => auth.api.getSession({ headers: identity.headers, query: { disableCookieCache: true } });
  const denied = () => {
    socket.close(1008, "Session or deployment access ended");
    const timeout = setTimeout(() => socket.terminate(), 1000);
    timeout.unref();
  };
  const authorize = async (deploymentId?: string) => {
    const current = await getSession();
    if (!current || current.user.id !== identity.userId) throw new Error("Session ended");
    if (deploymentId && !await prisma.deployment.findFirst({
      where: { id: deploymentId, ownerId: current.user.id }, select: { id: true },
    })) throw new Error("Deployment access denied");
  };
  let checking = false;
  const expiryTimer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try { await authorize(); } catch { denied(); }
    finally { checking = false; }
  }, 1000);
  socket.once("close", () => clearInterval(expiryTimer));
  attachDeploymentSubscription(socket, async (id, receive, signal) => {
    try { await authorize(id); }
    catch { denied(); throw new Error("Deployment access denied"); }
    let delivery = Promise.resolve();
    let pending = 0;
    return subscribeToDeployment(id, (event) => {
      if (++pending > 32) { denied(); return; }
      delivery = delivery.then(async () => {
        if (signal.aborted) return;
        await authorize(id);
        if (!signal.aborted) receive(event);
      }).catch(denied).finally(() => { pending--; });
    }, signal);
  });
});

configureHttpServer(server);
const stopHeartbeat = startSocketHeartbeat(wss);
const lifecycle = createShutdown(server, async () => {
  await new Promise<void>(resolve => wss.close(() => resolve()));
  redis.disconnect(); commandRedis.disconnect();
  await Promise.all([readiness.close(), prisma.$disconnect()]);
}, { stopIngress: () => {
  stopHeartbeat();
  for (const socket of wss.clients) socket.close(1001, "Server restarting");
  const force = setTimeout(() => { for (const socket of wss.clients) socket.terminate(); }, 1000);
  force.unref();
} });
shutdownOnSignals(lifecycle);
server.listen(3001, config.LISTEN_HOST);
