import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LearningLessonDetail } from "@infraforge/contracts/learning";
import { LessonBody } from "../src/features/learning/LessonPage";
import { lessonBodyView, selectCheckAnswer } from "../src/features/learning/viewModels";
import { EMPTY_DEVICE_STATE } from "../src/features/learning/deviceLocal";

test("the registered monitoring concept renders its reasoning, limitations and both check outcomes without a lab launch", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/monitoringLesson.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const detail = JSON.parse(output) as LearningLessonDetail;
  for (const answer of [null, "fresh", "discard", "separate"]) {
    const local = answer ? selectCheckAnswer(EMPTY_DEVICE_STATE, answer) : EMPTY_DEVICE_STATE;
    const view = lessonBodyView(detail, null, local, true);
    const html = renderToStaticMarkup(<MemoryRouter><LessonBody detail={detail} catalog={null} local={local} storageAvailable={true}
      onLocal={() => {}} onOpen={() => { throw Error("Concepts have no launch"); }} busy={false} /></MemoryRouter>);
    expect(view.lab).toBeNull();
    expect(html).not.toContain("Open challenge lab");
    expect(html).toContain("Conceptual only: no scored monitoring experiment");
    expect(html).toContain("Backend received counts accepted sample occurrences, including duplicates");
    expect(html).toContain("Target instrumentation CPU, physical telemetry persistence");
    expect(html).toContain("Missing age is Unknown");
    expect(html).toContain("device-local check, not server progress or mastery");
    if (answer) expect(html).toContain(detail.lesson.check!.explanation);
    if (view.feedback) expect(html).toContain(view.feedback);
  }
});
