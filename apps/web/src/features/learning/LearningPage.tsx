import { Link } from "react-router-dom";
import type { LearningCatalog } from "@infraforge/contracts/learning";
import { Button } from "@/ui/Button";
import { Field, Input, Select } from "@/ui/Field";
import { Loading, Notice, Page, PageHeader, Section } from "@/ui/Page";
import { Tag } from "@/ui/Tag";
import { EMPTY_FILTERS, KIND_LABEL, type LearningFilters } from "./discovery";
import { useLearningCatalog, useLearningFilters, useLearningOwner } from "./hooks";
import { LearningFocus } from "./LearningFocus";
import { catalogView, changeLearningFilter, requestView, type LearningRequest, type lessonRowView } from "./viewModels";

export type { LearningRequest } from "./viewModels";
export function LearningFailure({ error, retry }: { error: string; retry(): void }) {
  return <div className="mt-6"><Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" onClick={retry}>Try again</Button></div>;
}

function LessonRow({ lesson, activity, kindLabel, mode, href }: ReturnType<typeof lessonRowView>) {
  return <li className="border-t border-line py-4">
    <p className="text-sm text-ink-3"><Tag>{kindLabel}</Tag> · {lesson.level} · Available · {mode}</p>
    <h4 className="mt-1 text-lg font-semibold"><Link className="text-accent hover:underline" to={href}>{lesson.title}</Link></h4>
    <p className="mt-1 text-ink-2">{lesson.summary}</p>
    {activity && <p className="mt-2 text-sm"><Tag>Server activity: {activity}</Tag></p>}
  </li>;
}

export function LearningList({ data, loading, error, retry, filters, onFilters }: LearningRequest<LearningCatalog> & { filters: LearningFilters; onFilters(filters: LearningFilters): void }) {
  const request = requestView({ data, loading, error }, "Learning could not be loaded.");
  if (request.state === "loading") return <Loading label="Loading learning…" />;
  if (request.state === "error") return <LearningFailure error={request.error} retry={retry} />;
  const { resources, reviews, trackOptions, tracks, countLabel, emptyMessage } = catalogView(request.data, filters);
  const change = (key: keyof LearningFilters, value: string) => onFilters(changeLearningFilter(filters, key, value));
  return <>
    {reviews.length > 0 && <Section title="Worth revisiting" className="mt-6">
      <ul>{reviews.map(({ lesson, href, reason, concepts }) => <li key={lesson.id} className="mt-3">
        <Link className="text-accent hover:underline" to={href}>{lesson.title}</Link>
        <p className="mt-1 text-sm text-ink-2">{reason}</p>
        {concepts.length > 0 && <div className="mt-2 text-sm">
          <p>Concepts to revisit for this lab (advice):</p>
          <ul>{concepts.map((concept) => <li key={concept.id}>
            <Link className="text-accent hover:underline" to={concept.href}>{concept.title}</Link>
          </li>)}</ul>
        </div>}
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
        <Field label="Track">{({ id }) => <Select id={id} value={filters.track} onChange={(e) => change("track", e.target.value)}><option value="">All tracks</option>{trackOptions.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>
      </div>
      <Button className="mt-4" onClick={() => onFilters({ ...EMPTY_FILTERS })}>Clear filters</Button>
    </fieldset>
    <p role="status" aria-live="polite" className="mt-5 text-sm text-ink-3">{countLabel}</p>
    {emptyMessage && <p className="mt-4">{emptyMessage}</p>}
    {tracks.map((track) => <Section key={track.id} title={track.title} className="mt-8"><p className="text-ink-2">{track.summary}</p>
        {track.modules.map((module) => <Section key={module.id} title={module.title} level={3} className="mt-6">
          <p className="text-sm text-ink-3">{module.summary}</p>
          <ol className="mt-3">{module.lessons.map((row) => <LessonRow key={row.lesson.id} {...row} />)}</ol>
        </Section>)}
      </Section>)}
  </>;
}

function LearningSession() {
  const request = useLearningCatalog();
  const [filters, setFilters] = useLearningFilters();
  return <LearningFocus destination="learning"><Page><PageHeader title="Learning" lede="Follow a request, reason about a design, then try a linked challenge lab when one is available. Reading marks and check answers stay on this device; server activity comes from recorded attempts." />
    <LearningList {...request} filters={filters} onFilters={setFilters} />
  </Page></LearningFocus>;
}

export function LearningPage() {
  const owner = useLearningOwner();
  return <LearningSession key={owner} />;
}
