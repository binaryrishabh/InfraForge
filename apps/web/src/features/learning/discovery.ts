import type { LearningCatalog, LearningLessonSummary, LearningLevel, LessonKind, LessonProgress } from "@infraforge/contracts/learning";

export const KIND_LABEL: Record<LessonKind, string> = {
  reading: "Reading", "conceptual-exercise": "Concept check", "executable-lab": "Runnable lab",
};
export interface LearningFilters { level: LearningLevel | ""; kind: LessonKind | ""; resource: string; track: string; search: string }
export const EMPTY_FILTERS: LearningFilters = { level: "", kind: "", resource: "", track: "", search: "" };

// The current catalog has no authored concept/resource fields. Index the published
// title, summary and module topic; resource tags describe mentions, not runnable support.
const RESOURCE_TERMS = [
  { label: "DNS", pattern: /\bdns\b|name (?:lookup|resolution)/i },
  { label: "Load Balancer", pattern: /\bload balanc(?:er|ers|ing)\b/i },
  { label: "Virtual Machine", pattern: /\bvirtual machines?\b|\bvm\b/i },
  { label: "Database", pattern: /\bdatabases?\b/i },
  { label: "Cache", pattern: /\bcach(?:e|es|ing)\b/i },
  { label: "Firewall", pattern: /\bfirewalls?\b/i },
  { label: "Queue", pattern: /\bqueues?\b/i },
] as const;

export function discoveryTerms(lesson: LearningLessonSummary, catalog: LearningCatalog) {
  const module = catalog.tracks.find((t) => t.id === lesson.trackId)?.modules.find((m) => m.id === lesson.moduleId);
  const concepts = [lesson.title, lesson.summary, module?.title ?? ""];
  const source = `${lesson.title} ${lesson.summary}`;
  const resources: string[] = RESOURCE_TERMS.filter((r) => r.pattern.test(source)).map((r) => r.label);
  return { concepts, resources };
}

export function availableLessons(catalog: LearningCatalog): LearningLessonSummary[] {
  const byId = new Map(catalog.lessons.map((l) => [l.id, l]));
  return catalog.tracks.filter((t) => t.availability === "available").flatMap((t) => t.modules.filter((m) => m.availability === "available")
    .flatMap((m) => m.lessonIds.flatMap((id) => {
      const lesson = byId.get(id);
      return lesson?.availability === "available" && lesson.trackId === t.id && lesson.moduleId === m.id ? [lesson] : [];
    })));
}

export function discoverLessons(catalog: LearningCatalog, filters: LearningFilters): LearningLessonSummary[] {
  const words = filters.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return availableLessons(catalog).filter((lesson) => {
    const terms = discoveryTerms(lesson, catalog);
    const text = [...terms.concepts, ...terms.resources].join(" ").toLocaleLowerCase();
    return (!filters.level || lesson.level === filters.level) && (!filters.kind || lesson.kind === filters.kind)
      && (!filters.track || lesson.trackId === filters.track) && (!filters.resource || terms.resources.includes(filters.resource))
      && words.every((word) => text.includes(word));
  });
}

export function prerequisiteLessons(lesson: LearningLessonSummary, catalog: LearningCatalog) {
  const visible = new Map(availableLessons(catalog).map((l) => [l.id, l]));
  return lesson.prerequisites.map((id) => ({ id, lesson: visible.get(id) ?? null }));
}

export function lessonMode(lesson: LearningLessonSummary) {
  return lesson.kind === "executable-lab" ? "Linked challenge lab" : "Conceptual only";
}

export function activityLabel(lesson: LearningLessonSummary, progress: LessonProgress | null | undefined): string | null {
  if (lesson.kind !== "executable-lab" || !progress || progress.lessonId !== lesson.id || progress.challengeId !== lesson.experiment?.challengeId) return null;
  const labels: Record<LessonProgress["activity"], string> = {
    "not-started": "No recorded attempts", attempted: "Recorded attempt", "improved-after-attempt": "Recorded improvement", "requirements-met": "Current requirements met",
  };
  return `${labels[progress.activity]}${progress.fromEarlierVersion ? " · includes earlier version activity" : ""}`;
}
