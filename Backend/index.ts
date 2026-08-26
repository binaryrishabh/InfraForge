import express from "express";
import cors from "cors";
import { errorHandler } from "./utils/middleware";
import { config } from "./utils/config";
import { rateLimiter } from "./utils/rateLimiter";
import { deploymentQueue } from "./infra/queue";
import { infrastructureRouter } from "./routes/infrastructure.routes";
import { deploymentRouter } from "./routes/deployment.routes";

const app = express();
app.use(rateLimiter);
app.use(cors());
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

// Manual queue test — development only
if (config.NODE_ENV !== "production") {
  app.post("/api/test-deploy", async (req, res) => {
    await deploymentQueue.add("test-deployment", {
      deploymentId: "test-123",
      resources: ["vm", "database"]
    });
    res.status(200).json({
      message: "Job added to queue"
    });
  });
}

app.use(errorHandler);
app.listen(config.PORT);