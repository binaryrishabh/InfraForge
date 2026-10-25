import express from "express";
import { retireLegacyResetStorage } from "./auth/mailRequests";
import cors from "cors";
import { errorHandler } from "./utils/middleware";
import { config } from "./utils/config";
import { rateLimiter } from "./utils/rateLimiter";
import { toNodeHandler } from "better-auth/node";
import { auth, authSettings, accountQuota, emailOutbox } from "./auth/auth";
import { accountRouter } from "./auth/accountRoutes";
import { methodSettingsRouter } from "./auth/methodSettings";
import { accountAuthHandler } from "./auth/accountPolicy";
import { identifierSignIn } from "./auth/credentials";
import { checkOrigin, requireSession } from "./auth/httpSecurity";
import { infrastructureRouter } from "./routes/infrastructure.routes";
import { deploymentRouter } from "./routes/deployment.routes";
import { challengeRouter } from "./challenges/routes";
import { assertRuntimeSchema } from "./release/runtime";
import { createReadiness } from "./health/readiness";
import { internalModel2Router } from "./internalModel2/routes";
import { prisma } from "./lib/prisma";
import { redis, commandRedis } from "./infra/redis";
import { configureHttpServer, createShutdown, shutdownOnSignals } from "./utils/lifecycle";

await assertRuntimeSchema();
await retireLegacyResetStorage(prisma);
const readiness = createReadiness();
await readiness.started;
const stopEmail = emailOutbox?.start();
const app = express();
// Ports are bound to loopback by Compose. The local TLS proxy replaces forwarded headers.
app.set("trust proxy", config.NODE_ENV === "production" ? 1 : "loopback");
app.use((_req, res, next) => {
  if (lifecycle.isStopping()) { res.setHeader("Connection", "close"); res.status(503).json({ success: false }); return; }
  next();
});
app.get("/health/live", (_req, res) => res.json({ success: true }));
app.get(["/health", "/health/ready"], async (_req, res) => {
  const result = await readiness.check();
  res.status(result.success ? 200 : 503).json(result);
});
app.use(rateLimiter);
app.use("/api", checkOrigin);
app.use(cors({ origin: authSettings.origins, credentials: true }));
app.get("/api/auth/providers", (_req, res) => res.json({ credentials: true, providers: Object.keys(authSettings.socialProviders) }));
app.get("/api/auth/account-features", (_req, res) => res.json({ enabled: authSettings.accountEssentials.enabled,
  emailEnabled: authSettings.accountEssentials.emailEnabled, verificationRequired: authSettings.accountEssentials.verificationRequired,
  turnstileSiteKey: authSettings.accountEssentials.challenge ? authSettings.accountEssentials.siteKey ?? null : null }));
app.use("/api/auth", (req, res, next) => {
  // Keep parser/rate/timing route matching identical to the native handler.
  if (req.path.includes("%") || req.path.includes("//")) { res.status(400).json({ success: false }); return; }
  // Replace client input with Express's proxy-policy-validated address.
  req.headers["x-infraforge-client-ip"] = req.ip ?? "unknown";
  res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
// Bound credential bodies before password hashing, including chunked requests.
// The pinned Better Call Node adapter supports parsed JSON/form bodies. OAuth
// callbacks keep the library's original raw-body handling.
app.post(["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/sign-in/username", "/api/auth/sign-in/identifier",
  "/api/auth/request-password-reset", "/api/auth/send-verification-email", "/api/auth/reset-password",
  ...(authSettings.loginMethods.magicLink ? ["/api/auth/sign-in/magic-link"] : []),
  ...(authSettings.loginMethods.emailOtp ? ["/api/auth/email-otp/send-verification-otp", "/api/auth/sign-in/email-otp"] : [])],
  (req, res, next) => {
    if (!req.is("application/json") && !req.is("application/x-www-form-urlencoded")) {
      res.status(415).json({ success: false, message: "Use JSON or form data" }); return;
    }
    next();
  }, express.json({ limit: "8kb" }), express.urlencoded({ extended: false, limit: "8kb" }));
const authHandler = toNodeHandler({ handler: accountAuthHandler(auth.handler,
  authSettings.accountEssentials.emailEnabled, undefined, undefined, authSettings.loginMethods) });
app.post("/api/auth/sign-in/identifier", identifierSignIn(authHandler));
app.all("/api/auth/*splat", authHandler);
if (authSettings.loginMethods.settings) app.use("/api/account/settings", express.json({ limit: "8kb" }),
  methodSettingsRouter(prisma, auth, accountQuota, authSettings));
app.use("/api/account", express.json({ limit: "8kb" }), accountRouter(prisma, auth, accountQuota, authSettings.accountEssentials.enabled));
app.use("/api/infrastructure", requireSession);
app.use("/api/deployments", requireSession);
app.use("/api/challenges", requireSession);
app.use("/api/internal/model2", requireSession, internalModel2Router);
app.use(express.json());

// Domain routers
app.use("/api/infrastructure", infrastructureRouter);
app.use("/api/deployments", deploymentRouter);
app.use("/api/challenges", challengeRouter);
app.use((_req, res) => res.status(404).json({ success: false, message: "Resource not found" }));

app.use(errorHandler);
const server = app.listen(Number(config.PORT), config.LISTEN_HOST);
configureHttpServer(server);
const lifecycle = createShutdown(server, async () => {
  await stopEmail?.();
  redis.disconnect(); commandRedis.disconnect();
  await Promise.all([readiness.close(), prisma.$disconnect()]);
});
shutdownOnSignals(lifecycle);
