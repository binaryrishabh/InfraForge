import { requireCapability } from "../capabilities/policy";
import { randomUUID } from "node:crypto";
import { authoringGroups } from "@infraforge/contracts/internal-model2";
import { LESSON_VERSION } from "@infraforge/contracts/internal-lessons";
import type { LessonChoice, LessonReview } from "@infraforge/contracts/internal-lessons";
import { restartLesson } from "@infraforge/contracts/internal-lessons/profile";
import { assessDesign, authoredAssumptions, authoredContract } from "./authoring";
import { admissionSchema, compileEnvelope } from "./envelope";
import { contentHash } from "./identity";
import { LESSON_SANDBOX, lessonImage } from "./lessonLimits";
import { lessonEndpoint } from "./dockerEndpoint";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import { internalDatabase } from "./store";
export const lessonLayout = { resources: [
  { id: "lesson-vm", type: "Virtual Machine", name: "Application", x: 0, y: 0 },
  { id: "lesson-objects", type: "Object Storage", name: "Current objects", x: 200, y: 0 },
], connectionLines: [{ id: "lesson-link", sourceId: "lesson-vm", targetId: "lesson-objects", sourceType: "Virtual Machine", targetType: "Object Storage", port: 8080 }] };
function assessLessonDesign(row: Parameters<typeof assessDesign>[0]) {
  const design = assessDesign(row);
  if (!design.supported) return design;
  const layout = row.layout as typeof lessonLayout;
  const check = (value: object, keys: string[], path: string) => {
    for (const key of Object.keys(value)) if (!keys.includes(key)) design.reasons.push(`Unmodeled saved setting ${path}.${key}; select a separate lesson design. No saved fields were removed.`);
  };
  check(layout, ["resources", "connectionLines", "layoutVersion"], "layout");
  for (const resource of layout.resources) check(resource, ["id", "type", "name", "x", "y"], resource.id);
  for (const connection of layout.connectionLines) check(connection, ["id", "sourceId", "targetId", "sourceType", "targetType", "port"], connection.id);
  if (design.port !== 8080) design.reasons.push("This lesson profile requires an explicit port 8080 connection.");
  design.supported = design.reasons.length === 0; return design;
}
export async function lessonDesigns(owner: string) {
  const rows = await internalDatabase.query('SELECT id,name,layout,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt","challengeId" FROM "Infrastructure" WHERE "ownerId"=$1 ORDER BY "updatedAt" DESC LIMIT 100', [owner]);
  return rows.rows.map(assessLessonDesign);
}
export async function createLessonDesign(owner: string) {
  // One explicit, idempotent new design per owner. Never rewrite a saved layout.
  const hex = contentHash(`m2m-design/1:${owner}`), id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
  const existing = (await internalDatabase.query('SELECT "ownerId",layout FROM "Infrastructure" WHERE id=$1', [id])).rows[0];
  if (existing) {
    if (existing.ownerId !== owner || contentHash(existing.layout) !== contentHash(lessonLayout)) throw new ConflictError("The lesson design has changed. Select a supported saved design.");
    return id;
  }
  requireCapability(owner, { capability: "design.persist", operation: "create", countDelta: 1 });
  await internalDatabase.query(`INSERT INTO "Infrastructure" (id,"userId","ownerId",name,layout,"updatedAt")
    VALUES ($1,$2,$2,'Object restart lesson',$3,now()) ON CONFLICT (id) DO NOTHING`, [id, owner, lessonLayout]);
  const row = (await internalDatabase.query('SELECT "ownerId",layout FROM "Infrastructure" WHERE id=$1', [id])).rows[0];
  if (row?.ownerId !== owner || contentHash(row.layout) !== contentHash(lessonLayout)) throw new ConflictError("The lesson design has changed. Select a supported saved design; no fields were overwritten.");
  return id;
}
export async function reviewLesson(owner: string, choice: LessonChoice): Promise<LessonReview> {
  const image = lessonImage();
  const endpoint = lessonEndpoint();
  if (!image || !endpoint) throw new ConflictError("The isolated lesson image and endpoint must be configured. No default-context execution is available.");
  const row = (await internalDatabase.query('SELECT id,name,layout,"updatedAt" AT TIME ZONE \'UTC\' AS "updatedAt","challengeId" FROM "Infrastructure" WHERE id=$1 AND "ownerId"=$2', [choice.infrastructureId, owner])).rows[0];
  if (!row) throw new NotFoundError("Saved design not available");
  if (row.updatedAt.toISOString() !== choice.expectedDesignUpdatedAt) throw new ConflictError("Saved design changed. Refresh and review again.");
  const design = assessLessonDesign(row);
  if (!design.supported || design.port !== 8080) throw new ValidationError(design.reasons.join(" ") || "Lesson requires port 8080; the saved design is unchanged.");
  const draft = restartLesson(choice.phase), authored = authoredContract(draft, design);
  authored.contract.version = LESSON_VERSION;
  const request = admissionSchema.parse({ infrastructureId: choice.infrastructureId, expectedDesignUpdatedAt: choice.expectedDesignUpdatedAt, idempotencyKey: choice.idempotencyKey, workload: authored.workload, contract: authored.contract });
  const envelope = compileEnvelope(randomUUID(), owner, row.layout, row.updatedAt, request);
  const reviewHash = contentHash({ choice, request, image, endpoint, source: envelope.source, limits: LESSON_SANDBOX });
  return { choice, draft, image, reviewHash, explanation: ["A 24-byte current object is written, its process crashes, then it restarts with modeled logical state retained.", "Choose when to read it. The result comes from recorded execution; physical durability remains Unknown."],
    review: { request: request as LessonReview["review"]["request"], requestHash: contentHash(request), revision: design.updatedAt, designName: design.name,
      fields: authoringGroups.flatMap((g) => g.fields).map((f) => ({ field: f.label, value: authored.values[f.key]!, unit: f.unit, origin: draft.origin })),
      assumptions: [...authoredAssumptions, "This versioned teaching profile fixes all engineering inputs. Only the read phase is selectable.", `Isolated execution limits: ${JSON.stringify(LESSON_SANDBOX)}. These constrain software execution, not modeled cloud resources.`],
      arrivals: envelope.compiled.input.arrivals.reduce((n, a) => n + (a.kind === "trace" ? a.trace.rows.length : 0), 0) } };
}
