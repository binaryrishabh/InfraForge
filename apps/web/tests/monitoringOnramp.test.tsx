import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { LessonBody } from "../src/features/learning/LessonPage";
import { lessonBodyView, selectCheckAnswer } from "../src/features/learning/viewModels";
import { EMPTY_DEVICE_STATE } from "../src/features/learning/deviceLocal";

test("monitoring beginners can read, check every answer and continue to the concept without prior activity", async () => {
  const child = Bun.spawn([Bun.which("bun")!, "--no-env-file", resolve(import.meta.dir, "../../backend/tests/monitoringOnramp.fixture.ts")], {stdout: "pipe", stderr: "pipe"});
  const [output, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(await child.exited, errors).toBe(0);
  const { catalog, details } = JSON.parse(output) as {catalog: LearningCatalog; details: LearningLessonDetail[]};
  expect(catalog.progress).toEqual([]);
  for (const [index, detail] of details.entries()) {
    for (const answer of [null, ...(detail.lesson.check?.choices.map(c => c.id) ?? [])]) {
      const local = answer ? selectCheckAnswer(EMPTY_DEVICE_STATE, answer) : EMPTY_DEVICE_STATE;
      const view = lessonBodyView(detail, catalog, local, true);
      const html = renderToStaticMarkup(<MemoryRouter><LessonBody detail={detail} catalog={catalog} local={local} storageAvailable={true}
        onLocal={() => {}} onOpen={() => { throw Error("Concepts have no launch"); }} busy={false} /></MemoryRouter>);
      expect(view.lab).toBeNull();
      expect(html).not.toContain("Open challenge lab");
      expect(html).toContain("Prerequisites are advice, not locks.");
      for (const text of [...detail.lesson.explanation, ...detail.lesson.limitations]) {
        // HTML escaping can change punctuation; compare through the same React renderer.
        expect(html).toContain(renderToStaticMarkup(<p>{text}</p>).slice(3, -4));
      }
      if (details[index + 1]) expect(html).toContain(`href="/learn/lessons/${details[index + 1]!.lesson.id}"`);
      if (answer) {
        expect(html).toContain("device-local check, not server progress or mastery");
        expect(view.feedback).toStartWith(answer === detail.lesson.check!.correctChoiceId ? "That matches" : "Revisit");
        expect(html).toContain(view.feedback!);
      }
    }
  }
  const advanced = details[2]!;
  expect(lessonBodyView(advanced, catalog, EMPTY_DEVICE_STATE, true).prerequisites?.map(p => p.id)).toEqual(["missing-readings-are-unknown"]);
});
