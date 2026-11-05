import { useState } from "react";
import { Link } from "react-router-dom";
import type { LearningCatalog, LearningLessonSummary } from "@infraforge/contracts/learning";
import { Button } from "@/ui/Button";
import { Field, Input, Select } from "@/ui/Field";
import { Loading, Notice, Page, PageHeader, Section } from "@/ui/Page";
import { Tag } from "@/ui/Tag";
import { activityLabel, availableLessons, discoverLessons, discoveryTerms, EMPTY_FILTERS, KIND_LABEL, lessonMode, type LearningFilters } from "./discovery";
import { useLearningCatalog } from "./hooks";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { LearningFocus } from "./LearningFocus";

export interface LearningRequest<T> { data: T | null; loading: boolean; error: string | null; retry(): void }
export function LearningFailure({ error, retry }: { error: string; retry(): void }) {
  return <div className="mt-6"><Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" onClick={retry}>Try again</Button></div>;
}

function LessonRow({ lesson, catalog }: { lesson: LearningLessonSummary; catalog: LearningCatalog }) {
  const activity = activityLabel(lesson, catalog.progress.find((p) => p.lessonId === lesson.id));
  return <li className="border-t border-line py-4">
    <p className="text-sm text-ink-3"><Tag>{KIND_LABEL[lesson.kind]}</Tag> · {lesson.level} · Available · {lessonMode(lesson)}</p>
    <h4 className="mt-1 text-lg font-semibold"><Link className="text-accent hover:underline" to={`/learning/lessons/${encodeURIComponent(lesson.id)}`}>{lesson.title}</Link></h4>
    <p className="mt-1 text-ink-2">{lesson.summary}</p>
    {activity && <p className="mt-2 text-sm"><Tag>Server activity: {activity}</Tag></p>}
  </li>;
}

export function LearningList({ data, loading, error, retry, filters, onFilters }: LearningRequest<LearningCatalog> & { filters: LearningFilters; onFilters(filters: LearningFilters): void }) {
  if (loading) return <Loading label="Loading learning…" />;
  if (error || !data) return <LearningFailure error={error ?? "Learning could not be loaded."} retry={retry} />;
  const lessons = discoverLessons(data, filters), ids = new Set(lessons.map((l) => l.id));
  const resources = [...new Set(availableLessons(data).flatMap((l) => discoveryTerms(l, data).resources))].sort();
  const visible = new Map(availableLessons(data).map((l) => [l.id, l]));
  const reviews = data.suggestions.reviewCandidates.flatMap((suggestion) => {
    const lesson = visible.get(suggestion.lessonId);
    return lesson ? [{ lesson, reason: suggestion.reason }] : [];
  });
  const change = (key: keyof LearningFilters, value: string) => onFilters({ ...filters, [key]: value });
  return <>
    {reviews.length > 0 && <Section title="Worth revisiting" className="mt-6">
      <ul>{reviews.map(({ lesson, reason }) => <li key={lesson.id} className="mt-3">
        <Link className="text-accent hover:underline" to={`/learning/lessons/${encodeURIComponent(lesson.id)}`}>{lesson.title}</Link>
        <p className="mt-1 text-sm text-ink-2">{reason}</p>
      </li>)}</ul>
    </Section>}
    <fieldset aria-describedby="learning-filter-help" className="mt-6">
      <legend className="font-semibold">Find a lesson</legend>
      <p id="learning-filter-help" className="mt-2 text-sm text-ink-3">Filter by level, kind, resource topic or track. Prerequisites are suggestions; every available lesson can be opened.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Search lessons" hint="Search titles, concepts and resource names.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="search" value={filters.search} onChange={(e) => change("search", e.target.value)} />}</Field>
        <Field label="Level">{({ id }) => <Select id={id} value={filters.level} onChange={(e) => change("level", e.target.value)}><option value="">All levels</option>{["beginner", "intermediate", "advanced"].map((v) => <option key={v} value={v}>{v}</option>)}</Select>}</Field>
        <Field label="Kind">{({ id }) => <Select id={id} value={filters.kind} onChange={(e) => change("kind", e.target.value)}><option value="">All kinds</option>{Object.entries(KIND_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Select>}</Field>
        <Field label="Resource topic">{({ id }) => <Select id={id} value={filters.resource} onChange={(e) => change("resource", e.target.value)}><option value="">All resources</option>{resources.map((v) => <option key={v}>{v}</option>)}</Select>}</Field>
        <Field label="Track">{({ id }) => <Select id={id} value={filters.track} onChange={(e) => change("track", e.target.value)}><option value="">All tracks</option>{data.tracks.filter((t) => t.availability === "available").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>
      </div>
      <Button className="mt-4" onClick={() => onFilters({ ...EMPTY_FILTERS })}>Clear filters</Button>
    </fieldset>
    <p role="status" aria-live="polite" className="mt-5 text-sm text-ink-3">{lessons.length} {lessons.length === 1 ? "lesson" : "lessons"} found</p>
    {!lessons.length && <p className="mt-4">{availableLessons(data).length ? "No lessons match these filters. Try another search or clear the filters." : "No lessons are available yet."}</p>}
    {data.tracks.filter((t) => t.availability === "available").map((track) => {
      const modules = track.modules.filter((m) => m.availability === "available" && m.lessonIds.some((id) => ids.has(id)));
      if (!modules.length) return null;
      return <Section key={track.id} title={track.title} className="mt-8"><p className="text-ink-2">{track.summary}</p>
        {modules.map((module) => <Section key={module.id} title={module.title} level={3} className="mt-6">
          <p className="text-sm text-ink-3">{module.summary}</p>
          <ol className="mt-3">{lessons.filter((l) => l.trackId === track.id && l.moduleId === module.id).map((lesson) => <LessonRow key={lesson.id} lesson={lesson} catalog={data} />)}</ol>
        </Section>)}
      </Section>;
    })}
  </>;
}

function LearningSession() {
  const request = useLearningCatalog();
  const [filters, setFilters] = useState<LearningFilters>({ ...EMPTY_FILTERS });
  return <LearningFocus destination="learning"><Page><PageHeader title="Learning" lede="Follow a request, reason about a design, then try a linked challenge lab when one is available. Reading marks and check answers stay on this device; server activity comes from recorded attempts." />
    <LearningList {...request} filters={filters} onFilters={setFilters} />
  </Page></LearningFocus>;
}

export function LearningPage() {
  const owner = useAuthStore((s) => s.user?.id);
  return <LearningSession key={owner} />;
}
