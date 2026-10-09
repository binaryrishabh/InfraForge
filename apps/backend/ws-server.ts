import { WebSocketServer } from "ws";
import http from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import { auth, authSettings } from "./auth/auth";
import { prisma } from "./lib/prisma";
import { subscribeToDeployment } from "./infra/pubsub";
import { attachDeploymentSubscription, SUBSCRIPTION_MAX_BYTES } from "./infra/deploymentSubscriptions";

const server = http.createServer((_req, res) => { res.writeHead(200); res.end("ok"); });
const authenticated = new WeakMap<http.IncomingMessage, { headers: Headers; userId: string }>();
// Bun 1.3.14 exposes a synthetic upgrade socket. Its ws verifier sends HTTP
// rejection responses correctly; writing to that socket cannot do so reliably.
const wss = new WebSocketServer({ server, maxPayload: SUBSCRIPTION_MAX_BYTES,
  verifyClient: async ({ req }, done) => {
    if (!["/", "/ws"].includes(req.url ?? "") || !req.headers.origin || !authSettings.origins.includes(req.headers.origin)) {
      done(false, 403); return;
    }
    try {
      const headers = fromNodeHeaders(req.headers);
      const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
      if (!session) { done(false, 401); return; }
      authenticated.set(req, { headers, userId: session.user.id });
      done(true);
    } catch { done(false, 503); }
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
      where: { id: deploymentId, infrastructure: { ownerId: current.user.id } }, select: { id: true },
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

server.listen(3001);
