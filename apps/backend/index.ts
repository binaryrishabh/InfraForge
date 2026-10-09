import express from "express";
import cors from "cors";
import { errorHandler } from "./utils/middleware";
import { config } from "./utils/config";
import { rateLimiter } from "./utils/rateLimiter";
import { toNodeHandler } from "better-auth/node";
import { auth, authSettings } from "./auth/auth";
import { checkOrigin, requireSession } from "./auth/httpSecurity";
import { infrastructureRouter } from "./routes/infrastructure.routes";
import { deploymentRouter } from "./routes/deployment.routes";
import { assertRuntimeSchema } from "./release/runtime";
import { createReadiness } from "./health/readiness";

await assertRuntimeSchema();
const readiness = createReadiness();
const app = express();
// Ports are bound to loopback by Compose. The local TLS proxy replaces forwarded headers.
app.set("trust proxy", config.NODE_ENV === "production" ? 1 : "loopback");
app.get("/health/live", (_req, res) => res.json({ success: true }));
app.get(["/health", "/health/ready"], async (_req, res) => {
  const result = await readiness.check();
  res.status(result.success ? 200 : 503).json(result);
});
app.use(rateLimiter);
app.use("/api", checkOrigin);
app.use(cors({ origin: authSettings.origins, credentials: true }));
app.get("/api/auth/providers", (_req, res) => res.json({ providers: Object.keys(authSettings.socialProviders) }));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use("/api/infrastructure", requireSession);
app.use("/api/deployments", requireSession);
app.use(express.json());

// Domain routers
app.use("/api/infrastructure", infrastructureRouter);
app.use("/api/deployments", deploymentRouter);
app.use((_req, res) => res.status(404).json({ success: false, message: "Resource not found" }));

app.use(errorHandler);
app.listen(config.PORT);
