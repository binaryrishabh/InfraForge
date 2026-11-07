import { expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LearningLesson, LearningTrack } from "@infraforge/contracts/learning";
import { lessonText } from "../learning/claims";
import { learningContent } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { latestChallenge } from "../challenges/registry";

// Existing gates own schema, prerequisite existence/cycles/order, archive rules,
// challenge reviews and audited evidence labels. Do not repeat them here.
// Track entry is an editorial decision: these are intentional prerequisites,
// not locks, and these tracks do not promise an independent start from zero.
const ENTRY_REVIEWS: Record<string, { entry: string; prior: string[]; reason: string }> = {
  scaling: { entry: "up-or-out", prior: ["virtual-machines", "request-routing"],
    reason: "Capacity choices assume the foundations explanation of machines and routing." },
  data: { entry: "cache-hits-and-misses", prior: ["database-read-and-write"],
    reason: "Cache and database choices assume the foundations distinction between reads and writes." },
  async: { entry: "why-work-waits", prior: ["request-journey"],
    reason: "The queue on-ramp starts after the foundations request journey so publishing can be separated from completion." },
  failures: { entry: "firewall-rule-matching", prior: ["request-journey"],
    reason: "Diagnosing a denied dependency assumes the foundations request path." },
  missions: { entry: "open-and-size-an-api", prior: ["firewall-rule-matching", "find-the-denying-rule", "where-does-the-time-go"],
    reason: "Missions combine policy diagnosis and capacity experiments already practiced in other tracks." },
  depth: { entry: "concurrent-cache-misses", prior: ["cache-hits-and-misses"],
    reason: "Resource depth begins at intermediate policies; overlapping misses assume the earlier cache concept." },
  advanced: { entry: "diagnose-lost-app-capacity", prior: ["firewall-rule-matching", "find-the-denying-rule", "leave-room-for-firewall-flows"],
    reason: "Advanced practice deliberately builds investigations on earlier firewall concepts and measured labs." },
  architecture: { entry: "compare-designs-honestly", prior: ["first-bottleneck", "where-does-the-time-go", "response-time-and-throughput"],
    reason: "Design comparisons assume controlled bottleneck experiments and the foundations measurement vocabulary." },
  diagnosis: { entry: "read-before-changing", prior: ["request-journey", "response-time-and-throughput"],
    reason: "The beginner report-reading entry assumes foundations; the independent memory reading is intermediate." },
};

// Ordinary compound words in existing follow-up prompts, not navigation ids.
// Explicit URLs and parenthesized ids are always resolved, including these words.
const PROSE_COMPOUNDS = new Set([
  "database-only", "unfinished-request", "terminal-second", "whole-run", "one-change", "scale-out",
  "write-only", "stale-read", "mutable-data", "recovery-time", "connection-state", "tail-latency",
  "composed-budget", "working-set", "policy-only", "caller-work", "application-correctness",
  "evidence-cited", "over-budget", "near-miss", "health-probe", "slot-holding", "connection-acquisition",
  "saved-report", "wrong-fix", "in-flight", "live-only", "dependency-wait", "report-based",
]);
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const opening = (lesson: LearningLesson) => normalize(lesson.problem[0]!.split(/(?<=[.!?])\s/)[0]!);

// A conservative copied-opening check: exact wording or one word edited in a
// sentence of at least eight words. This is not a semantic similarity detector.
function copiedOpening(a: string, b: string) {
  if (a === b) return true;
  const left = a.split(" "), right = b.split(" ");
  if (Math.min(left.length, right.length) < 8 || Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + left.length - i + right.length - j <= 1;
}

function audit(lessons: readonly LearningLesson[], tracks: readonly LearningTrack[]) {
  const errors: string[] = [], byId = new Map(lessons.map(l => [l.id, l]));
  const exists = (id: string) => byId.has(id) || latestChallenge(id) !== null;
  const levels = { beginner: 0, intermediate: 1, advanced: 2 };
  for (const track of tracks) {
    for (const module of track.modules) {
      for (let i = 1; i < module.lessonIds.length; i++) {
        const before = byId.get(module.lessonIds[i - 1]!)!, after = byId.get(module.lessonIds[i]!)!;
        if (levels[before.level] > levels[after.level]) errors.push(`${track.id}/${module.id}: level decreases from ${before.id} to ${after.id}`);
      }
    }
    const independent = lessons.some(l => l.trackId === track.id && l.level === "beginner" && l.prerequisites.length === 0);
    const review = ENTRY_REVIEWS[track.id];
    if (independent) {
      if (review) errors.push(`${track.id}: entry review is obsolete; an independent beginner entry now exists`);
    } else if (!review) errors.push(`${track.id}: needs an entry prerequisite rationale`);
    else {
      const entry = byId.get(review.entry);
      const prior = entry?.prerequisites.filter(id => byId.get(id)?.trackId !== track.id);
      if (entry?.trackId !== track.id || JSON.stringify(prior) !== JSON.stringify(review.prior) || !review.reason.trim()) {
        errors.push(`${track.id}: entry prerequisite rationale needs review`);
      }
    }
  }
  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i]!;
    for (const other of lessons.slice(i + 1)) {
      if (normalize(lesson.title) === normalize(other.title)) errors.push(`${lesson.id}/${other.id}: duplicate title`);
      if (copiedOpening(opening(lesson), opening(other))) errors.push(`${lesson.id}/${other.id}: copied opening`);
    }
    for (const [field, text] of lessonText(lesson)) {
      for (const match of text.matchAll(/\/learn\/lessons\/([^\s/?#)\]<>"']+)/g)) {
        let id: string;
        try { id = decodeURIComponent(match[1]!); } catch { errors.push(`${lesson.id} ${field}: malformed lesson link`); continue; }
        if (!byId.has(id)) errors.push(`${lesson.id} ${field}: dead lesson link ${id}`);
      }
    }
    const followUp = lesson.followUp ?? "";
    const explicit = [...followUp.matchAll(/\(([a-z0-9]+(?:-[a-z0-9]+)+)\)/g)].map(m => m[1]!);
    const slugs = followUp.match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) ?? [];
    for (const id of new Set([...explicit, ...slugs.filter(id => !PROSE_COMPOUNDS.has(id))])) {
      if (!exists(id)) errors.push(`${lesson.id}: dead follow-up ${id}`);
    }
    // Choice ids and correctChoiceId are already validated. Identical displayed
    // alternatives are a separate ambiguity; answer length is irrelevant.
    if (lesson.check) {
      const choices = lesson.check.choices.map(c => normalize(c.text));
      if (new Set(choices).size !== choices.length) errors.push(`${lesson.id}: indistinguishable check choices`);
    }
  }
  return errors;
}

async function sourceLessons() {
  const root = fileURLToPath(new URL("../learning/content/", import.meta.url));
  const lessons: LearningLesson[] = [];
  for await (const file of new Bun.Glob("*/lessons/*.ts").scan({ cwd: root, absolute: true })) {
    const exports = Object.values(await import(pathToFileURL(file).href));
    const authored = exports.filter((value): value is LearningLesson => !!value && typeof value === "object" && "contentVersion" in value && "kind" in value);
    expect(authored, file).toHaveLength(1);
    lessons.push(...authored);
  }
  return lessons;
}

function auditSources(sources: readonly LearningLesson[]) {
  const errors: string[] = [], seen = new Set<string>();
  const current = LEARNING_REGISTRY.listLessons();
  for (const source of sources) {
    const identity = `${source.id}@${source.contentVersion}`;
    if (seen.has(identity)) errors.push(`${identity}: duplicate source identity`);
    seen.add(identity);
    if (JSON.stringify(LEARNING_REGISTRY.findLesson(source.id, source.contentVersion)) !== JSON.stringify(source)) {
      errors.push(`${identity}: source version is not registered and resolvable`);
    }
    const latest = LEARNING_REGISTRY.findLesson(source.id);
    if (!latest || source.contentVersion > latest.contentVersion) errors.push(`${identity}: source is newer than the current registry`);
    if (latest && source.contentVersion < latest.contentVersion && current.some(l => l.id === source.id && l.contentVersion === source.contentVersion)) {
      errors.push(`${identity}: superseded source listed as current`);
    }
  }
  for (const registered of [...learningContent.lessons, ...(learningContent.archivedLessons ?? [])]) {
    if (!seen.has(`${registered.id}@${registered.contentVersion}`)) errors.push(`${registered.id}: registered version has no lesson source`);
  }
  return errors;
}

test("canonical curriculum integrity covers editorial and source-registration gaps", async () => {
  const lessons = LEARNING_REGISTRY.listLessons(), tracks = LEARNING_REGISTRY.listTracks();
  // Refusal probes run through the same audit as the real catalogue. No engine,
  // authoring bypass, production mutation or alternative learning registry.
  const refuses = (change: (lessons: LearningLesson[], tracks: LearningTrack[]) => void, message: string) => {
    const copy = structuredClone(lessons), trackCopy = structuredClone(tracks);
    change(copy, trackCopy);
    expect(audit(copy, trackCopy).join("\n")).toContain(message);
  };
  refuses(l => { l[1]!.title = l[0]!.title.toUpperCase(); }, "duplicate title");
  refuses(l => { l[1]!.problem[0] = l[0]!.problem[0]!; }, "copied opening");
  expect(copiedOpening("a caller waits for the database to finish this request", "a caller waits for the database to finish that request")).toBe(true);
  expect(copiedOpening("a caller waits for the database to finish this request", "a caller waits for the shared database to finish this request")).toBe(true);
  expect(copiedOpening("a caller waits for the database to finish this request", "another caller retries while the database still finishes older work")).toBe(false);
  refuses(l => { l[0]!.level = "advanced"; }, "level decreases");
  refuses(l => { l[0]!.followUp = "Next open absent-lesson."; }, "dead follow-up absent-lesson");
  refuses(l => { l[0]!.followUp = "Next open (near-miss)."; }, "dead follow-up near-miss");
  refuses(l => { l[0]!.explanation[0] += " [Next](/learn/lessons/absent-lesson)."; }, "dead lesson link absent-lesson");
  refuses(l => { l[0]!.followUp = "/learn/lessons/%ZZ"; }, "malformed lesson link");
  refuses(l => { const c = l.find(l => l.check)!.check!; c.choices[1]!.text = c.choices[0]!.text; }, "indistinguishable check choices");
  refuses(l => { l[0]!.prerequisites = ["client-and-server"]; }, "needs an entry prerequisite rationale");
  refuses(l => { l.find(l => l.id === "why-work-waits")!.prerequisites = []; }, "entry review is obsolete");
  refuses(l => { l.find(l => l.id === "why-work-waits")!.prerequisites = ["client-and-server"]; }, "entry prerequisite rationale needs review");
  const sources = await sourceLessons();
  expect(sources.length).toBeGreaterThan(0);
  const orphan = { ...sources[0]!, contentVersion: 9999 };
  expect(auditSources([...sources, orphan]).join("\n")).toContain("source version is not registered and resolvable");
  expect(auditSources([...sources, orphan]).join("\n")).toContain("source is newer than the current registry");
  expect(auditSources(sources.slice(1)).join("\n")).toContain("registered version has no lesson source");
  expect(auditSources([...sources, sources[0]!]).join("\n")).toContain("duplicate source identity");
  const errors = [...audit(lessons, tracks), ...auditSources(sources)];
  console.info(`Integrity audit: ${tracks.length} tracks, ${lessons.length} current lessons, ${sources.length} source versions; ${errors.length} defects`);
  expect(errors).toEqual([]);
});
