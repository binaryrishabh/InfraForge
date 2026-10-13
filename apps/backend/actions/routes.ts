import { Router } from "express";
import { z } from "zod";
import type { ActionRequest } from "@infraforge/contracts/actions";
import { prisma } from "../lib/prisma";
import { NotFoundError, ValidationError } from "../utils/errors";
import { requestRunAction } from "./persistence";
import { actionDto } from "./contract";

export const actionRouter = Router();
const paths = { load: "load", speed: "speed", chaos: "chaos", "scale-vertical": "vertical-scale",
  "scale-pool": "pool-scale", "sync-topology": "topology", teardown: "teardown" } as const;
for (const [path, kind] of Object.entries(paths)) {
  actionRouter.post(`/:deploymentId/${path}`, async (req, res) => {
    const parsed = z.uuid().safeParse(req.params.deploymentId);
    if (!parsed.success) throw new ValidationError("A valid deployment ID is required.");
    const action = await requestRunAction(parsed.data, res.locals.userId,
      { kind, parameters: kind === "teardown" ? {} : req.body } as ActionRequest);
    const completed = action.status === "completed";
    res.status(completed ? 200 : 202).json({ success: true, deploymentId: parsed.data, action,
      message: completed ? "Action completed" : "Action requested; simulator application is pending.",
      ...(action.kind === "topology" ? { topologyRevision: action.outcome?.acceptedRevision ??
        (action.parameters as Extract<ActionRequest, { kind: "topology" }>["parameters"]).acceptedRevision } : {}) });
  });
}
actionRouter.get("/:deploymentId/actions/:actionId", async (req, res) => {
  const parsed = z.object({ deploymentId: z.uuid(), actionId: z.uuid() }).safeParse(req.params);
  if (!parsed.success) throw new ValidationError("Valid run and action IDs are required.");
  const action = await prisma.runAction.findFirst({ where: { id: parsed.data.actionId,
    deploymentId: parsed.data.deploymentId, deployment: { ownerId: res.locals.userId } } });
  if (!action) throw new NotFoundError("Action not found");
  res.json({ success: true, action: actionDto(action) });
});
