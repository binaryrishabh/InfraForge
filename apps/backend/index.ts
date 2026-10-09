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

const app = express();
app.use(rateLimiter);
app.use("/api", checkOrigin);
app.use(cors({ origin: authSettings.origins, credentials: true }));
app.get("/api/auth/providers", (_req, res) => res.json({ providers: Object.keys(authSettings.socialProviders) }));
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use("/api/infrastructure", requireSession);
app.use("/api/deployments", requireSession);
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Domain routers
app.use("/api/infrastructure", infrastructureRouter);
app.use("/api/deployments", deploymentRouter);
app.use((_req, res) => res.status(404).json({ success: false, message: "Resource not found" }));

app.use(errorHandler);
app.listen(config.PORT);
