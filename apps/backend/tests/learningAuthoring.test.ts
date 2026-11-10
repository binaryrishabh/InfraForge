import { expect, test } from "bun:test";
import { checkLearningAuthoring } from "../learning/authoring";
import { learningContent } from "../learning/content";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { buildRegistry, REGISTRY } from "../challenges/registry";
import { LEARNING_REPORT_MEASUREMENTS } from "@infraforge/contracts/learning";
import { readFileSync } from "node:fs";
import { CLAIM_EXCEPTIONS } from "../learning/claimExceptions";
import { checkLessonClaims, lessonText, numericClaims, sizeClaims } from "../learning/claims";

test("check:learning validates all authored content and lists counts", () => {
  const counts = checkLearningAuthoring(learningContent);
  expect(counts).toEqual({
    tracks: learningContent.tracks.length,
    lessons: learningContent.lessons.length,
    labs: learningContent.lessons.filter((lesson) => lesson.kind === "executable-lab").length,
    archived: learningContent.archivedLessons?.length ?? 0,
  });
  console.info(`Learning: ${counts.tracks} tracks, ${counts.lessons} lessons, ${counts.labs} executable labs, ${counts.archived} archived versions`);
  const count = (kind: string) => learningContent.lessons.filter(lesson => lesson.kind === kind).length;
  const labs = learningContent.lessons.filter(lesson => lesson.kind === "executable-lab");
  console.info(JSON.stringify({ byKind: { reading: count("reading"), "conceptual-exercise": count("conceptual-exercise"),
    "executable-lab": labs.length }, labsByLevel: Object.fromEntries(["beginner", "intermediate", "advanced"].map(level =>
      [level, labs.filter(lesson => lesson.level === level).length])) }));
});

test("every lab review is mandatory, and moving any linked challenge still requires a new review", () => {
  for (const lab of learningContent.lessons.filter(lesson => lesson.kind === "executable-lab")) {
    const reviews = { ...REVIEWED_CHALLENGES };
    delete reviews[`${lab.id}@${lab.contentVersion}`];
    expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow(`${lab.id}@${lab.contentVersion}: missing challenge review`);
    const old = REGISTRY.latest(lab.experiment.challengeId)!.definition;
    const registry = buildRegistry([...REGISTRY.all().map(entry => entry.definition), { ...old, version: old.version + 1 }]);
    expect(() => checkLearningAuthoring(learningContent, REVIEWED_CHALLENGES, registry)).toThrow("moved since contentVersion");
  }
});

test("the authoring gate fails on deliberately broken content and a missing challenge", () => {
  const broken = structuredClone(learningContent);
  broken.lessons[0]!.limitations = [];
  expect(() => checkLearningAuthoring(broken)).toThrow("limitations");
  const missing = structuredClone(learningContent);
  const lab = missing.lessons.find((l) => l.kind === "executable-lab")!;
  lab.experiment!.challengeId = "missing";
  expect(() => checkLearningAuthoring(missing)).toThrow("unknown challengeId missing");
});

test("a newer latest challenge is a hard human-review failure even when old rules still exist", () => {
  const old = REGISTRY.latest("where-does-the-time-go")!.definition;
  const changed = buildRegistry([...REGISTRY.all().map((e) => e.definition), { ...old, version: old.version + 1 }]);
  expect(() => checkLearningAuthoring(learningContent, REVIEWED_CHALLENGES, changed)).toThrow("moved since contentVersion");
});

test("new content versions need review; missing or changed reviewed rules fail closed", () => {
  const content = structuredClone(learningContent);
  content.lessons.find((l) => l.kind === "executable-lab")!.contentVersion++;
  expect(() => checkLearningAuthoring(content)).toThrow("missing challenge review");
  const reviews = structuredClone(REVIEWED_CHALLENGES);
  reviews["where-does-the-time-go@1"]!.hash = "0".repeat(64);
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow("identity is unavailable or changed");
  reviews["where-does-the-time-go@1"]!.version = 999;
  expect(() => checkLearningAuthoring(learningContent, reviews)).toThrow("identity is unavailable or changed");
});

test("a newly reviewed version can coexist with its immutable archived content", () => {
  const content = structuredClone(learningContent);
  // This lab needs no out-of-definition numeric exceptions. A new version of
  // prose that does need them must get separately reviewed exception entries.
  const lab = content.lessons.find((l) => l.id === "route-around-a-slow-vm")!;
  const oldLesson = structuredClone(lab);
  lab.contentVersion++;
  const old = REGISTRY.latest(lab.experiment!.challengeId)!.definition;
  const registry = buildRegistry([...REGISTRY.all().map((e) => e.definition), { ...old, version: old.version + 1 }]);
  const entry = registry.latest(old.id)!;
  const versioned = { ...content, archivedLessons: [...(content.archivedLessons ?? []), oldLesson] };
  // All current labs still need their reviews, including labs added in other tracks.
  // An archive keeps the original review; the new version gets a separate identity.
  expect(checkLearningAuthoring(versioned, {
    ...REVIEWED_CHALLENGES, [`${lab.id}@${lab.contentVersion}`]: { challengeId: old.id, version: entry.definition.version, hash: entry.hash },
  }, registry)).toMatchObject({ archived: versioned.archivedLessons.length });
  expect(() => checkLearningAuthoring(versioned, REVIEWED_CHALLENGES, registry)).toThrow("missing challenge review");
  expect(versioned.archivedLessons.at(-1)).toEqual(oldLesson);
});

for (const original of learningContent.lessons.filter(l => l.kind === "executable-lab")) {
  test(`${original.id}: refuses an unsupported workload number and an unrendered measurement`, () => {
    const content = structuredClone(learningContent);
    const lab = content.lessons.find(l => l.id === original.id)!;
    lab.problem[0] = "The workload offers 98765 requests/second.";
    expect(() => checkLearningAuthoring(content)).toThrow("unsupported numeric/size claim 98765");
    lab.problem = [...original.problem];
    lab.experiment!.evidenceToInspect = ["Cache hits; invented recovery duration"];
    expect(() => checkLearningAuthoring(content)).toThrow("report does not render measurement Cache hits");
    expect(() => checkLearningAuthoring(content)).toThrow("report does not render measurement invented recovery duration");
  });
}

test("numbers in another pinned field cannot authorize a wrong request rate or evaluation second", () => {
  const content = structuredClone(learningContent);
  const lab = content.lessons.find(l => l.id === "where-does-the-time-go")!;
  lab.problem[0] = "The workload offers 12 requests/second; inspect CPU at second 100.";
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported request rate 12");
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported evaluation second 100");
  lab.problem[0] = "Complete requests with p95 at most 12 ms.";
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported p95 threshold 12 ms");
});

test("claim rates use the domain's per-hour conversion as well as per-minute", () => {
  const lesson = structuredClone(learningContent.lessons.find(l => l.id === "where-does-the-time-go")!);
  const pinned = structuredClone(REGISTRY.latest(lesson.experiment!.challengeId)!.definition);
  pinned.workload = { ...pinned.workload, targetThroughput: 350 * 3600, throughputUnit: "per-hour" };
  expect(checkLessonClaims(lesson, pinned)).toEqual([]);
  lesson.problem[0] = "The workload offers 12 reads/second.";
  expect(checkLessonClaims(lesson, pinned)).toContain(`${lesson.id}@1 problem.0: unsupported request rate 12`);
  lesson.problem[0] = "The workload offers twelve reads/second.";
  expect(checkLessonClaims(lesson, pinned)).toContain(`${lesson.id}@1 problem.0: unsupported request rate 12`);
});

test("scenario claims use pinned step times, end boundaries and numeric inputs, refusing unrelated seconds", () => {
  const lesson = structuredClone(learningContent.lessons.find(l => l.id === "investigate-a-pool-reset")!);
  const pinned = structuredClone(REGISTRY.latest(lesson.experiment!.challengeId)!.definition);
  pinned.scenario!.steps[0] = {id: "step-98765", atSecond: 17, request: {
    interventionId: "cpu-capacity", revision: 98765, target: {resourceId: "db-98765"}, parameters: {cores: 0.03, duration: 11},
  }};
  pinned.scenario!.steps[1]!.atSecond = 19;
  lesson.problem[0] = "At second 17, reduce DB CPU to 0.03 cores for eleven seconds, ending just after second 28. Reset the pool at second 19; evaluate at second 6.";
  expect(checkLessonClaims(lesson, pinned)).toEqual([]);
  // Four is pinned as the starter retry limit; eleven is a duration, not a boundary.
  for (const second of [4, 11, 18]) {
    lesson.problem[0] = `Inspect CPU at second ${second}.`;
    expect(checkLessonClaims(lesson, pinned)).toContain(`${lesson.id}@1 problem.0: unsupported evaluation second ${second}`);
  }
  // Descriptive ids, target ids and request revisions must never authorize prose.
  lesson.problem[0] = "The intervention uses 98765 cores.";
  expect(checkLessonClaims(lesson, pinned).join("\n")).toContain("unsupported numeric/size claim 98765");
  lesson.problem[0] = "The intervention uses 0.04 cores.";
  expect(checkLessonClaims(lesson, pinned).join("\n")).toContain("unsupported numeric/size claim 0.04");
});

test("queue counters are allowed only when this challenge renders their requirement detail", () => {
  const content = structuredClone(learningContent);
  content.lessons.find(l => l.id === "where-does-the-time-go")!.experiment!.evidenceToInspect = ["Queue: acknowledged"];
  expect(() => checkLearningAuthoring(content)).toThrow("without a queue-work requirement");
});

test("spelled quantities and instance names cannot bypass the numeric gate", () => {
  expect(numericClaims("two hundred reads/second; twenty-five ms; one thousand connections")).toEqual(["200", "25", "1000"]);
  expect(numericClaims("a ten-second controller interval; a two-second delay")).toEqual(["10", "2"]);
  const content = structuredClone(learningContent);
  content.lessons.find(l => l.id === "where-does-the-time-go")!.problem[0] = "The workload offers thirteen reads/second.";
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported numeric/size claim 13");
});

test("numeric labs need educational model output limitations, including drafts and archives", () => {
  const content = structuredClone(learningContent);
  const lab = content.lessons.find(l => l.id === "where-does-the-time-go")!;
  lab.availability = "draft";
  lab.limitations = ["No production guarantee."];
  expect(() => checkLearningAuthoring(content)).toThrow("educational model outputs");
  lab.availability = "available";
  const old = structuredClone(lab);
  lab.contentVersion++;
  // Both the bad archive and the missing new review must be reported.
  expect(() => checkLearningAuthoring({ ...content, archivedLessons: [old] })).toThrow("educational model outputs");
});

test("reading and conceptual result numbers cannot hide in follow-ups or checks", () => {
  for (const kind of ["reading", "conceptual-exercise"] as const) for (const field of ["problem", "followUp", "check"] as const) {
    const content = structuredClone(learningContent), lesson = content.lessons.find(l => l.kind === kind)!;
    if (field === "problem") lesson.problem[0] = "Recorded p95 was 25 ms.";
    else if (field === "followUp") lesson.followUp = "The modeled run completed 350 requests/second.";
    else lesson.check = { question: "Did the run finish in 12 seconds?", choices: [{id: "a", text: "Yes"}, {id: "b", text: "No"}], correctChoiceId: "b", explanation: "No run is known." };
    expect(() => checkLearningAuthoring(content)).toThrow("digits-with-units result claim");
  }
  const content = structuredClone(learningContent);
  content.lessons.find(l => l.kind === "reading")!.followUp = "Recorded app CPU reached 99%.";
  expect(() => checkLearningAuthoring(content)).toThrow("digits-with-units result claim");
});

test("measurement allow-list stays anchored in existing saved-report renderers", () => {
  const root = new URL("../../../", import.meta.url);
  const report = readFileSync(new URL("apps/web/src/features/reports/components/ReportMeasurements.tsx", root), "utf8");
  const debrief = readFileSync(new URL("apps/web/src/features/challenges/components/ChallengeDebrief.tsx", root), "utf8");
  for (const definition of Object.values(LEARNING_REPORT_MEASUREMENTS)) {
    const source = readFileSync(new URL(definition.source, root), "utf8");
    expect(source).toContain(definition.marker);
    if (definition.source.includes("/live/") || definition.source.includes("SecuritySection")) {
      const component = definition.source.split("/").at(-1)!.replace(".tsx", "");
      // Verify both edges for nested renderers rather than assuming a direct import.
      const parent = component === "DatabaseRejoinReadings" ? "DatabaseReplicationReadings" :
        ["WholeRunReadings", "LatencyBreakdown"].includes(component) ? "TrafficEvidence" : null;
      expect(parent ? readFileSync(new URL(`apps/web/src/features/live/${parent}.tsx`, root), "utf8") : report).toContain(component);
      if (parent) expect(report).toContain(parent);
    }
    if (definition.source.endsWith("/ActionTimeline.tsx")) {
      expect(readFileSync(new URL("apps/web/src/features/reports/components/ReportView.tsx", root), "utf8")).toContain("<ActionTimeline actions={report.actions}");
    }
  }
  // Queue fields are rendered by the existing requirement-detail row.
  expect(debrief).toContain("{c.detail}");
  expect(readFileSync(new URL("apps/backend/reports/report.ts", root), "utf8")).toContain("evaluateAttempt");
});

test("numeric exception reviews are exact, scoped, justified and used", () => {
  const identities = new Set<string>();
  for (const entry of CLAIM_EXCEPTIONS) {
    const key = `${entry.lesson}:${entry.field}`;
    expect(identities.has(key)).toBe(false); identities.add(key);
    expect(entry.reason.length).toBeGreaterThan(40);
    const lesson = [...learningContent.lessons, ...(learningContent.archivedLessons ?? [])].find(l => `${l.id}@${l.contentVersion}` === entry.lesson)!;
    expect(lesson).toBeDefined();
    expect(lessonText(lesson)).toContainEqual([entry.field, entry.text]);
    expect(entry.values.length).toBeGreaterThan(0);
    for (const value of entry.values) expect([...numericClaims(entry.text), ...sizeClaims(entry.text)]).toContain(value);
  }
  const content = structuredClone(learningContent);
  const lab = content.lessons.find(l => l.id === "where-does-the-time-go")!;
  lab.explanation[2] = lab.explanation[2]!.replace("c5.large", "c99.unknown");
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported numeric/size claim c99.unknown");
  lab.explanation[2] = "The starter size is c5.large.";
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported numeric/size claim c5.large");
  lab.explanation[2] = "The starter Instance size is Medium.";
  expect(() => checkLearningAuthoring(content)).toThrow("unsupported numeric/size claim medium");
});

test("advanced reference and calibrated-result exceptions refuse changed prose", () => {
  for (const [id, field, token] of [
    ["diagnose-lost-app-capacity", "explanation", "8"],
    ["budget-for-a-partition", "explanation", "c5.large"],
    ["trace-a-saturation-cascade", "limitations", "0"],
  ] as const) {
    const lesson = structuredClone(learningContent.lessons.find(l => l.id === id)!);
    const index = id === "diagnose-lost-app-capacity" ? 2 : field === "limitations" ? 1 : 0;
    lesson[field][index] += " Cite the report.";
    expect(checkLessonClaims(lesson, REGISTRY.latest(id)!.definition).join("\n")).toContain(`unsupported numeric/size claim ${token}`);
  }
});
