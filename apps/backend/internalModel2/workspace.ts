import { randomUUID } from "node:crypto";
import { Router } from "express";
import { authoringGroups } from "@infraforge/contracts/internal-model2";
import { internalDatabase } from "./store";
import { assessDesign, authoringRequest, authoredContract, authoredAssumptions } from "./authoring";
import { compileEnvelope, CompilationRefusal } from "./envelope";
import { contentHash } from "./identity";
import { ConflictError, NotFoundError } from "../utils/errors";
export const workspaceRouter = Router();
workspaceRouter.get("/workspace", async (_req, res) => {
  const rows = await internalDatabase.query('SELECT id,name,layout,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt","challengeId" FROM "Infrastructure" WHERE "ownerId"=$1 ORDER BY "updatedAt" DESC LIMIT 100', [res.locals.userId]);
  res.json({ success: true, designs: rows.rows.map(assessDesign), limit: 100 });
});
workspaceRouter.post("/validate", async (req, res) => {
  const parsed = authoringRequest.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ diagnostics: parsed.error.issues.map((e) => ({ code: "AUTHORING_FIELD", path: e.path.join("."), message: `${e.message}. Complete this field before review.` })) }); return; }
  const input = parsed.data;
  const row = (await internalDatabase.query('SELECT id,name,layout,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt","challengeId" FROM "Infrastructure" WHERE id=$1 AND "ownerId"=$2', [input.infrastructureId, res.locals.userId])).rows[0];
  if (!row) throw new NotFoundError("Saved design not available");
  if (row.updatedAt.toISOString() !== input.expectedDesignUpdatedAt) throw new ConflictError("Saved design changed. Refresh designs, select its revision and validate again.");
  const design = assessDesign(row);
  if (!design.supported) { res.status(422).json({ diagnostics: design.reasons.map((message) => ({ code: "AUTHORING_SCOPE", path: "infrastructureId", message })) }); return; }
  try {
    const authored = authoredContract(input.authoring, design);
    const request = { infrastructureId: input.infrastructureId, expectedDesignUpdatedAt: input.expectedDesignUpdatedAt, idempotencyKey: input.idempotencyKey, workload: authored.workload, contract: authored.contract };
    const envelope = compileEnvelope(randomUUID(), res.locals.userId, row.layout, row.updatedAt, request);
    res.json({ success: true, review: { request, requestHash: contentHash(request), revision: design.updatedAt, designName: design.name,
      fields: authoringGroups.flatMap((g) => g.fields).map((f) => ({ field: f.label, value: authored.values[f.key], unit: f.unit, origin: input.authoring.origin })), assumptions: authoredAssumptions,
      arrivals: envelope.compiled.input.arrivals.reduce((n, a) => n + (a.kind === "trace" ? a.trace.rows.length : 0), 0) } });
  } catch (error) { if (error instanceof CompilationRefusal) { res.status(422).json({ diagnostics: error.diagnostics }); return; } throw error; }
});
