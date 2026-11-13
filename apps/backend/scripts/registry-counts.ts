/* Prints exact curriculum and challenge counts from the live registries (never from report prose).
   bun --no-env-file apps/backend/scripts/registry-counts.ts [--json] [--compare <earlier.json>]
   Save an earlier tree's output with --json, then pass it to --compare on a later tree to list what was added or removed. */
import { readFileSync } from "node:fs";
import { learningContent as content } from "../learning/content";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { REGISTRY, categoryOf } from "../challenges/registry";

const labLessons = content.lessons.filter((l) => l.kind === "executable-lab");
const count = (items: string[]) => items.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
const latest = REGISTRY.listLatest();
const taught = new Set(labLessons.map((l) => (l as { experiment: { challengeId: string } }).experiment.challengeId));

export const counts = {
  tracks: content.tracks.map((t) => ({
    id: t.id, availability: t.availability,
    modules: t.modules.map((m) => ({
      id: m.id, availability: m.availability, lessons: m.lessonIds.length,
      labs: m.lessonIds.filter((id) => labLessons.some((l) => l.id === id)).length,
    })),
  })),
  lessons: { total: content.lessons.length, archived: content.archivedLessons?.length ?? 0,
    byKind: count(content.lessons.map((l) => l.kind)), byAvailability: count(content.lessons.map((l) => l.availability)) },
  labs: { total: labLessons.length, lessonIds: labLessons.map((l) => l.id).sort(),
    challengeIds: [...taught].sort() },
  challenges: { distinct: latest.length, versions: CHALLENGE_VERSIONS.length,
    byCategory: count(latest.map((e) => categoryOf(e.definition))), ids: latest.map((e) => e.definition.id).sort(),
    withoutLab: latest.map((e) => e.definition.id).filter((id) => !taught.has(id)).sort() },
};

const args = process.argv.slice(2);
const compareAt = args.indexOf("--compare");
if (args.includes("--json")) console.log(JSON.stringify(counts, null, 2));
else {
  const modules = counts.tracks.flatMap((t) => t.modules);
  console.log(`tracks ${counts.tracks.length} (${counts.tracks.filter((t) => t.availability === "available").length} available), modules ${modules.length}`);
  for (const t of counts.tracks) console.log(`  ${t.id} [${t.availability}] ${t.modules.length} modules, ${t.modules.reduce((n, m) => n + m.lessons, 0)} lessons, ${t.modules.reduce((n, m) => n + m.labs, 0)} labs`);
  console.log(`lessons ${counts.lessons.total} (+${counts.lessons.archived} archived versions) by kind ${JSON.stringify(counts.lessons.byKind)}`);
  console.log(`runnable labs (executable-lab lessons) ${counts.labs.total}, challenge ids taught ${counts.labs.challengeIds.length}`);
  console.log(`challenges ${counts.challenges.distinct} distinct, ${counts.challenges.versions} versions, by category ${JSON.stringify(counts.challenges.byCategory)}`);
  console.log(`challenges without a lab lesson: ${counts.challenges.withoutLab.length}`);
}
if (compareAt >= 0) {
  const before = JSON.parse(readFileSync(args[compareAt + 1]!, "utf8")) as typeof counts;
  const diff = (now: string[], was: string[]) => ({ added: now.filter((x) => !was.includes(x)), removed: was.filter((x) => !now.includes(x)) });
  const labs = diff(counts.labs.lessonIds, before.labs.lessonIds), challenges = diff(counts.challenges.ids, before.challenges.ids);
  console.log(`since the compared tree: lessons ${before.lessons.total} -> ${counts.lessons.total}, labs ${before.labs.total} -> ${counts.labs.total}, challenges ${before.challenges.distinct} -> ${counts.challenges.distinct}`);
  console.log(`labs added ${labs.added.length}: ${labs.added.join(", ")}`);
  console.log(`labs removed ${labs.removed.length}: ${labs.removed.join(", ")}`);
  console.log(`challenges added ${challenges.added.length}, removed ${challenges.removed.length}`);
}
