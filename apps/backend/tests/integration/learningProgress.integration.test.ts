import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import type { DesignChangeReview } from "@infraforge/contracts/reports";
import { listLearningLessons } from "../../learning/registry";
import { latestChallenge } from "../../challenges/registry";
import { choicesFor } from "../../challenges/prediction";
import { REFERENCE, tier } from "../challengeHarness";
import { LocalHarness, readLocalSettings } from "./localHarness";
import { submitBrowserRun } from "./browserRunChecks";

// Opt in against an ALREADY prepared disposable API/worker. This test never migrates or starts services.
// Lane B's registered lab content is needed for the production catalog to expose an executable lesson.
const lab = listLearningLessons().find((l) => l.kind === "executable-lab" && !!REFERENCE[l.experiment.challengeId] &&
  latestChallenge(l.experiment.challengeId)?.definition.engine === "2");
const integration = process.env.INTEGRATION_RUN === "1" && process.env.INTEGRATION_LEARNING_API === "1" && lab ? test : test.skip;

integration("learning API derives saved challenge/replay progress with real sessions and owner isolation (prepared DB and registered lab required)", async () => {
  if (!lab || lab.kind !== "executable-lab") throw new Error("A registered executable lab is required");
  const h = new LocalHarness(readLocalSettings(process.env));
  const d = latestChallenge(lab.experiment.challengeId)!.definition;
  const users: string[] = [], designs: string[] = [], runs: string[] = [];
  const register = async () => {
    const suffix = randomUUID().replaceAll("-", ""), email = `${suffix}@infraforge.test`;
    const response = await fetch(h.api + "/auth/sign-up/email", { method: "POST", headers: { "Content-Type": "application/json", Origin: h.origin },
      body: JSON.stringify({ name: "Learning fixture", username: `Learn_${suffix.slice(0, 12)}`, email, password: randomUUID() + "Aa1!" }) });
    const user = (await h.sql.query('SELECT id FROM "User" WHERE email=$1', [email])).rows[0];
    if (user) users.push(user.id);
    expect(response.ok).toBe(true);
    const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookie.length).toBeGreaterThan(0);
    return cookie;
  };
  const progress = async () => ((await h.request("/learning")) as LearningCatalog).progress.find((p) => p.lessonId === lab.id)!;
  try {
    await h.request("/learning", undefined, "GET", 401);
    await h.request(`/learning/lessons/${lab.id}`, undefined, "GET", 401);
    const alice = await register(), bob = await register(); h.cookie = alice;
    expect(await progress()).toMatchObject({ activity: "not-started", attempts: 0 });
    await h.request("/learning/lessons/not-a-lesson", undefined, "GET", 404);
    const detail = await h.request(`/learning/lessons/${lab.id}`) as LearningLessonDetail;
    expect(detail.challenge).toMatchObject({ id: d.id, version: d.version, executable: true });
    let workspace = (await h.request(`/challenges/${detail.challenge!.id}/workspace`, {}, "POST", 201)).designId;
    designs.push(workspace);
    for (const [i, layout] of [d.starter ?? tier(1), REFERENCE[d.id]!].entries()) {
      let improvement;
      if (i > 0) {
        const copy = (await h.request(`/challenges/${d.id}/improvement-workspace`, { sourceRunId: runs[0] }, "POST", 201)).infrastructure;
        workspace = copy.id; designs.push(workspace);
        const review = (await h.request(`/challenges/${d.id}/improvement-preview`, { sourceRunId: runs[0], infrastructureId: workspace,
          layout: { ...layout, layoutVersion: 3 } }, "POST")).review as DesignChangeReview;
        expect(review.count).toBeGreaterThan(0);
        improvement = { sourceRunId: runs[0], hypothesis: "I expect the changed capacity to meet more of the recorded requirements.",
          intent: "improvement", inputHash: review.inputHash, acknowledgeMultiple: review.classification === "several-changes" };
      }
      await h.request(`/infrastructure/${workspace}`, { layout: { ...layout, layoutVersion: 3 } }, "PUT");
      const prediction = { answers: Object.fromEntries(d.predictions.map((q) => [q.id, choicesFor(q.kind, layout.resources.map((r) => r.type), d.engine)[0]!])), reasoning: null };
      await h.request(`/challenges/${d.id}/attempts`, { infrastructureId: workspace, prediction: { answers: {}, reasoning: null }, ...(improvement ? { improvement } : {}) }, "POST", 400);
      const run = (await h.request(`/challenges/${d.id}/attempts`, { infrastructureId: workspace, prediction, ...(improvement ? { improvement } : {}) }, "POST", 201)).createdDeployment;
      runs.push(run.id);
      expect(await progress()).toMatchObject({ activity: "attempted", attempts: i + 1 });
      await submitBrowserRun(h, run.id, d.evaluationSeconds);
      const report = (await h.request(`/deployments/${run.id}/report`)).report;
      expect(report.challenge.status).toBe(i === 0 ? "not-met" : "met");
      if (improvement) expect(report.run.learning).toMatchObject({ sourceRunId: runs[0], intent: "improvement", hypothesis: improvement.hypothesis });
      expect(await progress()).toMatchObject({ activity: i === 0 ? "attempted" : "requirements-met", predictionReviewed: true, attempts: i + 1, lastRunId: run.id });
    }
    const comparison = (await h.request(`/deployments/compare?a=${runs[0]}&b=${runs[1]}`)).comparison;
    expect(comparison).toMatchObject({ challengeConditions: "same", lineage: "source-and-improvement" });
    expect((await progress()).sameConditionsComparison).toBe(true);
    h.cookie = bob;
    expect(await progress()).toMatchObject({ activity: "not-started", attempts: 0, lastRunId: null, sameConditionsComparison: false });
    expect((await h.request(`/learning/lessons/${lab.id}?ownerId=${users[0]}`)).progress.attempts).toBe(0);
  } finally {
    try {
      await h.sql.query('DELETE FROM "Deployment" WHERE id=ANY($1::text[])', [runs]);
      await h.sql.query('DELETE FROM "Infrastructure" WHERE id=ANY($1::text[])', [designs]);
      await h.sql.query('DELETE FROM "User" WHERE id=ANY($1::text[])', [users]);
    } finally { await h.close(); }
  }
}, 180000);
