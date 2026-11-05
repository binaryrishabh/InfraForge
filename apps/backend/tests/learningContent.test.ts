import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { LearningContent, LearningLesson } from "@infraforge/contracts/learning";
import { latestChallenge } from "../challenges/registry";
import { learningContent } from "../learning/content";
import { buildLearningRegistry, LEARNING_REGISTRY } from "../learning/registry";
import { CONTENT_LIMITS, SIMULATED_RESULT_PHRASES, validateLearningContent } from "../learning/validate";

function copy() {
  return structuredClone(learningContent) as { tracks: LearningContent["tracks"][number][]; lessons: LearningLesson[]; archivedLessons: LearningLesson[] };
}
type Fixture = ReturnType<typeof copy>;
const first = (c: Fixture) => c.lessons[0]!;
const exercise = (c: Fixture) => c.lessons[1]!;
function lab(c: Fixture) {
  const l = first(c);
  c.lessons[0] = { ...l, kind: "executable-lab", experiment: { challengeId: "first-production-api", prediction: null } };
}
function refuses(change: (c: Fixture) => void, message: string) {
  const c = copy(); change(c);
  expect(validateLearningContent(c).join("\n")).toContain(message);
}

test("real foundations content validates and follows the whole beginner path; runnable labs live only in first-runs", () => {
  expect(validateLearningContent(learningContent)).toEqual([]);
  const track = LEARNING_REGISTRY.findTrack("foundations")!;
  expect(track.title).toBe("Track 1: Foundations");
  expect(track.modules.map((m) => m.id)).toEqual(["requests-and-routing", "compute-and-data", "load-and-limits", "first-runs"]);
  const ids = track.modules.filter((m) => m.id !== "first-runs").flatMap((m) => m.lessonIds);
  expect([...ids, ...track.modules.find((m) => m.id === "first-runs")!.lessonIds]).toEqual(learningContent.lessons.map((l) => l.id));
  expect(ids).toHaveLength(10);
  for (const id of ids) {
    const l = LEARNING_REGISTRY.findLesson(id)!;
    expect(l.level).toBe("beginner");
    expect(l.experiment).toBeNull();
    expect(l.limitations.length).toBeGreaterThan(0);
    expect(l.prerequisites.every((prerequisite) => ids.indexOf(prerequisite) < ids.indexOf(id))).toBe(true);
    if (l.kind === "conceptual-exercise") expect(l.check.choices.some((c) => c.id === l.check.correctChoiceId)).toBe(true);
  }
  for (const id of track.modules.find((m) => m.id === "first-runs")!.lessonIds) expect(LEARNING_REGISTRY.findLesson(id)!.kind).toBe("executable-lab");
});

describe("authoring refusals", () => {
  const cases: [string, (c: Fixture) => void, string][] = [
    ["duplicate lesson ids", (c) => c.lessons.push(structuredClone(first(c))), "lesson ids must be unique"],
    ["duplicate track ids", (c) => c.tracks.push(structuredClone(c.tracks[0]!)), "track ids must be unique"],
    ["duplicate module ids", (c) => c.tracks[0]!.modules.push(structuredClone(c.tracks[0]!.modules[0]!)), "module ids must be unique"],
    ["missing module lesson", (c) => c.tracks[0]!.modules[0]!.lessonIds.push("missing"), "missing lesson missing"],
    ["duplicate module lesson", (c) => c.tracks[0]!.modules[0]!.lessonIds.push(first(c).id), "exactly one module"],
    ["unlisted lesson", (c) => c.tracks[0]!.modules[0]!.lessonIds.shift(), "exactly one module"],
    ["wrong existing module", (c) => first(c).moduleId = "compute-and-data", "inconsistent with track.ts"],
    ["unknown module", (c) => first(c).moduleId = "missing", "unknown trackId/moduleId"],
    ["unknown track", (c) => first(c).trackId = "missing", "unknown trackId/moduleId"],
    ["missing prerequisite", (c) => first(c).prerequisites = ["missing"], "missing prerequisite missing"],
    ["duplicate prerequisite", (c) => exercise(c).prerequisites.push("what-is-a-request"), "prerequisites must be unique"],
    ["self cycle", (c) => first(c).prerequisites = [first(c).id], "prerequisite cycle"],
    ["indirect cycle", (c) => first(c).prerequisites = ["request-journey"], "prerequisite cycle"],
    ["beginner requires advanced", (c) => first(c).level = "advanced", "beginner lesson requires advanced"],
    ["empty limitations", (c) => first(c).limitations = [], "limitations"],
    ["blank limitation", (c) => first(c).limitations = ["  "], "limitations"],
    ["unknown challenge", (c) => { lab(c); first(c).experiment!.challengeId = "missing"; }, "unknown challengeId"],
    ["too few check choices", (c) => exercise(c).check!.choices.pop(), "choices"],
    ["duplicate check choice ids", (c) => exercise(c).check!.choices[1]!.id = "client", "choice ids must be unique"],
    ["invalid correct choice", (c) => exercise(c).check!.correctChoiceId = "missing", "invalid correctChoiceId"],
    ["missing conceptual check", (c) => Object.assign(exercise(c), { check: null }), "check"],
    ["reading with experiment", (c) => Object.assign(first(c), { experiment: { challengeId: "first-production-api", prediction: null } }), "experiment"],
    ["conceptual with experiment", (c) => Object.assign(exercise(c), { experiment: { challengeId: "first-production-api", prediction: null } }), "experiment"],
    ["lab without experiment", (c) => Object.assign(first(c), { kind: "executable-lab", experiment: null }), "experiment"],
    ["invalid id", (c) => first(c).id = "Not a slug", "id"],
    ["invalid version", (c) => first(c).contentVersion = 0, "contentVersion"],
    ["unknown kind", (c) => Object.assign(first(c), { kind: "pretend-lab" }), "kind"],
    ["unknown availability", (c) => Object.assign(first(c), { availability: "coming-soon" }), "availability"],
  ];
  for (const [name, change, message] of cases) test(name, () => refuses(change, message));

  test("the registry refuses invalid content before exposing it", () => {
    const c = copy(); first(c).limitations = [];
    expect(() => buildLearningRegistry(c)).toThrow("Invalid learning content");
  });
});

test("lab lookup uses the actual latest challenge and requires a prediction source", () => {
  const c = copy(); lab(c);
  expect(latestChallenge(first(c).experiment!.challengeId)?.definition.version).toBe(2);
  expect(validateLearningContent(c)).toEqual([]);
  expect(validateLearningContent(c, () => ({ definition: { predictions: [] } })).join("\n")).toContain("needs prediction text or challenge predictions");
  first(c).experiment!.prediction = "Which resource will have the highest CPU at the evaluation second?";
  expect(validateLearningContent(c, () => ({ definition: { predictions: [] } }))).toEqual([]);
  first(c).experiment!.prediction = " ";
  expect(validateLearningContent(c).join("\n")).toContain("prediction");
});

test("only indefensible level ordering is refused; prerequisites remain advisory", () => {
  const c = copy(); first(c).level = "intermediate";
  expect(validateLearningContent(c)).toEqual([]);
  expect(buildLearningRegistry(c).findLesson("first-bottleneck")?.id).toBe("first-bottleneck");
});

describe("small simulated-result editorial guard", () => {
  for (const phrase of SIMULATED_RESULT_PHRASES) {
    for (const kind of ["reading", "conceptual-exercise"] as const) test(`${kind}: ${phrase}`, () => {
      refuses((c) => { const l = kind === "reading" ? first(c) : exercise(c); l.explanation[0] = `${phrase.toUpperCase()} a capacity result.`; }, "claims simulated results");
    });
  }
  test("check text is reviewed too, and whitespace cannot hide a listed phrase", () => {
    refuses((c) => exercise(c).check!.choices[0]!.text = "The recorded\nrun shows a result.", "claims simulated results");
  });
  test("conceptual discussion of measurements is allowed and labs can discuss their recorded run", () => {
    const c = copy(); first(c).explanation[0] = "A measurement needs a stated interval and a source.";
    expect(validateLearningContent(c)).toEqual([]);
    lab(c); first(c).explanation[0] = "The recorded run shows only what was measured under its stated conditions.";
    expect(validateLearningContent(c)).toEqual([]);
  });
});

describe("bounded authoring", () => {
  const textFields = ["title", "summary"] as const;
  for (const field of textFields) test(`lesson ${field}`, () => refuses((c) => first(c)[field] = "x".repeat(CONTENT_LIMITS[field] + 1), field));
  test("whitespace padding cannot bypass raw text bounds", () => refuses((c) => first(c).title = `Title${" ".repeat(CONTENT_LIMITS.title)}`, "title"));
  for (const field of ["problem", "explanation", "limitations"] as const) {
    test(`${field} paragraph length`, () => refuses((c) => first(c)[field][0] = "x".repeat(CONTENT_LIMITS.paragraph + 1), field));
    test(`${field} paragraph count`, () => refuses((c) => first(c)[field] = Array.from({ length: CONTENT_LIMITS[field] + 1 }, () => "Text."), field));
    test(`${field} minimum count`, () => refuses((c) => first(c)[field] = field === "explanation" ? ["Only one."] : [], field));
  }
  test("prerequisite count", () => refuses((c) => first(c).prerequisites = Array.from({ length: CONTENT_LIMITS.prerequisites + 1 }, (_, i) => `lesson-${i}`), "prerequisites"));
  test("choice count", () => refuses((c) => exercise(c).check!.choices = Array.from({ length: CONTENT_LIMITS.choices + 1 }, (_, i) => ({ id: `choice-${i}`, text: "Choice." })), "choices"));
  for (const field of ["question", "explanation"] as const) test(`check ${field}`, () => refuses((c) => exercise(c).check![field] = "x".repeat((field === "question" ? 240 : CONTENT_LIMITS.paragraph) + 1), field));
  test("choice text", () => refuses((c) => exercise(c).check!.choices[0]!.text = "x".repeat(241), "text"));
  test("track title", () => refuses((c) => c.tracks[0]!.title = "x".repeat(CONTENT_LIMITS.title + 1), "title"));
  test("track summary", () => refuses((c) => c.tracks[0]!.summary = "x".repeat(CONTENT_LIMITS.summary + 1), "summary"));
  test("module title", () => refuses((c) => c.tracks[0]!.modules[0]!.title = "x".repeat(CONTENT_LIMITS.title + 1), "title"));
  test("module summary", () => refuses((c) => c.tracks[0]!.modules[0]!.summary = "x".repeat(CONTENT_LIMITS.summary + 1), "summary"));
  test("module count", () => refuses((c) => c.tracks[0]!.modules = Array.from({ length: CONTENT_LIMITS.modules + 1 }, () => c.tracks[0]!.modules[0]!), "modules"));
  test("track count", () => refuses((c) => c.tracks = Array.from({ length: CONTENT_LIMITS.tracks + 1 }, () => c.tracks[0]!), "tracks"));
  test("lesson count", () => refuses((c) => c.lessons = Array.from({ length: CONTENT_LIMITS.lessons + 1 }, () => first(c)), "lessons"));
  test("module lesson count", () => refuses((c) => c.tracks[0]!.modules[0]!.lessonIds = Array.from({ length: CONTENT_LIMITS.lessons + 1 }, () => first(c).id), "lessonIds"));
  test("prediction length", () => refuses((c) => { lab(c); first(c).experiment!.prediction = "x".repeat(401); }, "prediction"));
});

test("registry lookups filter by track, module and challenge and preserve authored order", () => {
  const c = copy(); lab(c);
  const registry = buildLearningRegistry(c);
  expect(registry.listLessons({ trackId: "foundations", moduleId: "requests-and-routing" }).map((l) => l.id)).toEqual(c.tracks[0]!.modules[0]!.lessonIds);
  expect(registry.listLessons({ challengeId: "first-production-api" }).map((l) => l.id)).toEqual([first(c).id]);
  expect(registry.listLessons({ trackId: "missing" })).toEqual([]);
  expect(registry.listLessons({ moduleId: "missing" })).toEqual([]);
  expect(registry.listLessons({ challengeId: "missing" })).toEqual([]);
  expect(registry.findTrack("missing")).toBeNull();
  expect(registry.findModule("missing", "requests-and-routing")).toBeNull();
  expect(registry.findModule("foundations", "missing")).toBeNull();
  expect(registry.findLesson("missing")).toBeNull();
  expect(registry.findLesson(first(c).id, 99)).toBeNull();
});

for (const parent of ["lesson", "module", "track"] as const) test(`draft ${parent} is absent from all learner projections`, () => {
  const c = copy();
  if (parent === "lesson") first(c).availability = "draft";
  if (parent === "module") c.tracks[0]!.modules[0]!.availability = "draft";
  if (parent === "track") c.tracks[0]!.availability = "draft";
  const registry = buildLearningRegistry(c);
  expect(registry.findLesson(first(c).id)).toBeNull();
  expect(registry.findLesson(first(c).id, 1)).toBeNull();
  expect(registry.listLessons().some((l) => l.id === first(c).id)).toBe(false);
  expect(registry.listTracks().flatMap((t) => t.modules.flatMap((m) => m.lessonIds))).not.toContain(first(c).id);
  expect(JSON.stringify(registry.listTracks())).not.toContain('"draft"');
  expect(JSON.stringify(registry.listLessons())).not.toContain('"draft"');
  if (parent === "track") expect(registry.findTrack("foundations")).toBeNull();
  if (parent !== "lesson") expect(registry.findModule("foundations", "requests-and-routing")).toBeNull();
});

test("published old versions stay resolvable without duplicating the current lesson list", () => {
  const c = copy(); c.archivedLessons.push(structuredClone(first(c)));
  first(c).contentVersion = 2; first(c).title = "A request, revisited";
  const registry = buildLearningRegistry(c);
  expect(registry.findLesson(first(c).id)?.contentVersion).toBe(2);
  expect(registry.findLesson(first(c).id, 1)?.title).toBe("What is a request?");
  expect(registry.listLessons()).toHaveLength(13);
});

for (const [name, change] of [
  ["duplicate identity", (c: Fixture) => c.archivedLessons.push(structuredClone(first(c)))],
  ["unknown current lesson", (c: Fixture) => c.archivedLessons.push({ ...first(c), id: "missing" })],
  ["future archive", (c: Fixture) => c.archivedLessons.push({ ...first(c), contentVersion: 2 })],
  ["draft archive", (c: Fixture) => { first(c).contentVersion = 2; c.archivedLessons.push({ ...first(c), contentVersion: 1, availability: "draft" }); }],
  ["moved archive", (c: Fixture) => { first(c).contentVersion = 2; c.archivedLessons.push({ ...first(c), contentVersion: 1, moduleId: "other" }); }],
  ["cyclic archived prerequisites", (c: Fixture) => { first(c).contentVersion = 2; c.archivedLessons.push({ ...first(c), contentVersion: 1, prerequisites: ["request-journey"] }); }],
] as const) test(`refuses archive ${name}`, () => {
  const c = copy(); change(c); expect(validateLearningContent(c).length).toBeGreaterThan(0);
});

test("content and registry results are deterministic and detached from callers", () => {
  const c = copy(), before = JSON.stringify(c), registry = buildLearningRegistry(c);
  expect(validateLearningContent(c)).toEqual(validateLearningContent(c));
  expect(JSON.stringify(c)).toBe(before);
  const expected = registry.listLessons();
  first(c).title = "Caller changed input";
  registry.findLesson(expected[0]!.id)!.problem.push("Caller changed output");
  registry.listLessons()[0]!.limitations.length = 0;
  registry.listTracks()[0]!.modules.length = 0;
  registry.findTrack("foundations")!.modules.length = 0;
  registry.findModule("foundations", "requests-and-routing")!.lessonIds.length = 0;
  expect(registry.listLessons()).toEqual(expected);
  expect(registry.findModule("foundations", "requests-and-routing")!.lessonIds).toHaveLength(4);
  expect(buildLearningRegistry(copy()).listTracks()).toEqual(registry.listTracks());
});

// Published identities are immutable. Keep these pins when adding a new contentVersion.
const PUBLISHED: Record<string, string> = {
  "what-is-a-request@1": "9aadbe6497b2167edfb327dfcb20b04767d4a07ddcfaa8ba1de382602fdd13b3",
  "client-and-server@1": "deddc60bce963ff4b5f022d347c74ce30ee6b53c8d5d55507398ee280e9d97b9",
  "dns-resolution@1": "4f535b9f739c83be301cfbc40602242b1d328aa2c74ad18d6e6efdcebdab2e6a",
  "request-routing@1": "8e060821af958cbb8b2438b9c1df99197cc7f86e23849712f4895a8b8145a653",
  "virtual-machines@1": "1bb378de7cda107bcf337354c969a28f1deb994921c2da14ab0264279070d325",
  "database-read-and-write@1": "48f8621903b9bdacdc6c969c478c70dc58771a1991f5cd8b11ccb6a1605d513e",
  "request-journey@1": "96b60966d4ade869c8c7433320ee519903630596973c5df81be759d58fd07868",
  "response-time-and-throughput@1": "6aa184778c05bfd0e43ec9bf269c450324827637024ab5ee40fa65d37558934d",
  "more-users-more-pressure@1": "bde96e6ddf75b4dd83bc39b0c6eed3b9058cdb780d6528b0ccabfd7304d2704c",
  "first-bottleneck@1": "59403bbb59a799d76f3656b5a867a1a402384cef782b447713d4c417a47cf229",
};

test("published text is pinned, bounded and still explicitly resolvable", () => {
  expect(Object.keys(PUBLISHED)).toHaveLength(10);
  for (const [identity, hash] of Object.entries(PUBLISHED)) {
    const [id, version] = identity.split("@");
    const l = LEARNING_REGISTRY.findLesson(id!, Number(version));
    expect(l).not.toBeNull();
    expect(createHash("sha256").update(JSON.stringify(l)).digest("hex")).toBe(hash);
  }
});
