import { Fragment } from "react";
import { Link, useParams } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { useOpenChallenge } from "@/features/challenges/useOpenChallenge";
import { Button } from "@/ui/Button";
import { Loading, Notice, Page, PageHeader, Section } from "@/ui/Page";
import { Tag } from "@/ui/Tag";
import { useDeviceLesson, useLearningCatalog, useLearningLesson, useLearningOwner } from "./hooks";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import type { DeviceLessonState } from "./deviceLocal";
import { LessonActivity } from "./LessonActivity";
import { latestLessonRun } from "./lessonActivityData";
import { LearningFocus } from "./LearningFocus";
import { lessonBodyView, lessonPageView, selectCheckAnswer, toggleReadMark } from "./viewModels";

export function LessonBody({ detail, catalog, local, storageAvailable, onLocal, onOpen, busy }: {
  detail: LearningLessonDetail; catalog: LearningCatalog | null; local: DeviceLessonState; storageAvailable: boolean;
  onLocal(value: DeviceLessonState): void; onOpen(id: string): void; busy: boolean;
}) {
  const view = lessonBodyView(detail, catalog, local, storageAvailable);
  const { lesson, activity, lab, next } = view;
  return <>
    <p className="mt-4 text-sm text-ink-3"><Tag>{view.kindLabel}</Tag> · {lesson.level} · {view.mode}</p>
    {activity && <p className="mt-2 text-sm"><Tag>Server activity: {activity}</Tag></p>}
    <aside className="mt-4 text-sm" aria-label="Suggested prerequisites">
      <p>Prerequisites are advice, not locks.</p>
      {view.prerequisites ? <ul>{view.prerequisites.map(({ id, lesson: prerequisite, href, label }) => <li key={id}>{prerequisite
        ? <Link className="text-accent hover:underline" to={href}>{label}</Link>
        : label}</li>)}</ul> : <p>Prerequisite links are unavailable until the learning list loads.</p>}
    </aside>
    {view.sections.map(({ id, title }) => <Fragment key={id}>{(() => {
      switch (id) {
        case "problem": return <Section title={title} className="mt-6">{lesson.problem.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>;
        case "explanation": return <Section title={title} className="mt-6">{lesson.explanation.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>;
        case "prediction": return <Section title={title} className="mt-6"><p>{view.prediction}</p></Section>;
        case "experiment": return <Section title={title} className="mt-6">
          {lab?.canOpen ? <><p className="mb-3">Open “{lab.title}” to design and record a prediction before starting an attempt.</p>
            <Button variant="primary" loading={busy} onClick={() => onOpen(lab.challengeId)}>Open challenge lab</Button>
          </> : <Notice role="status">The linked challenge is unavailable for running. No experiment result is known.</Notice>}
        </Section>;
        case "evidence": return <Section title={title} className="mt-6">
          <p>After a run is saved, inspect its report: the recorded inputs, each requirement and its evidence, and the prediction review. Missing measurements remain unknown. A terminal-second reading does not describe the whole run.</p>
          {lab && lab.evidence.length > 0 && <ul className="mt-3 list-disc pl-5">{lab.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
          {view.latestRunId ? <Link className="mt-3 inline-block text-accent hover:underline" to={`/runs/${encodeURIComponent(view.latestRunId)}`}>Inspect the latest recorded attempt</Link>
            : <p className="mt-3 text-sm text-ink-3">No recorded attempt is linked here. No outcome is claimed.</p>}
        </Section>;
        case "limitations": return <Section title={title} className="mt-6">{lesson.limitations.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>;
        case "followUp": return <Section title={title} className="mt-6"><p>{view.followUp}</p>
          {next ? <Link className="mt-3 inline-block text-accent hover:underline" to={next.href}>Next in track order: {next.title}</Link>
            : <Link className="mt-3 inline-block text-accent hover:underline" to="/learning">Find another lesson</Link>}
        </Section>;
        case "check": return <Section title={title} className="mt-6">
          {lesson.check ? <fieldset aria-describedby="check-help">
            <legend className="font-semibold">{lesson.check.question}</legend>
            <p id="check-help" className="mt-2 text-sm text-ink-3">Choose an answer for an immediate explanation. This is a device-local check, not server progress or mastery.</p>
            {view.choices.map((choice) => <label key={choice.id} className="mt-3 flex items-center gap-2">
              <input type="radio" name={`check-${lesson.id}`} value={choice.id} checked={choice.checked} onChange={() => onLocal(selectCheckAnswer(local, choice.id))} />{choice.text}
            </label>)}
            {view.feedback && <p role="status" aria-live="polite" className="mt-4">{view.feedback}</p>}
          </fieldset> : <p>This lesson has no check question. Try explaining the problem in your own words.</p>}
        </Section>;
      }
    })()}</Fragment>)}
    <div className="mt-6 border-t border-line pt-5">
      <Button aria-pressed={local.read} onClick={() => onLocal(toggleReadMark(local))}>{view.readLabel}</Button>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-3">{view.storageMessage} These are personal notes, not server progress or mastery.</p>
    </div>
  </>;
}

function DeviceLesson({ detail, catalog }: { detail: LearningLessonDetail; catalog: LearningCatalog | null }) {
  const local = useDeviceLesson(detail.lesson.id, detail.lesson.contentVersion);
  const { open, busy } = useOpenChallenge();
  return <><LessonBody detail={detail} catalog={catalog} local={local.value} storageAvailable={local.available} onLocal={local.update} onOpen={(id) => void open(id)} busy={busy !== null} />
    {latestLessonRun(detail) && <LessonActivity detail={detail} />}</>;
}

export function LessonView({ data, loading, error, retry, catalog }: LearningRequest<LearningLessonDetail> & { catalog: LearningRequest<LearningCatalog> }) {
  const request = lessonPageView({ data, loading, error });
  if (request.state === "loading") return <LearningFocus destination={request.destination}><Page><h1 className="mt-8 text-2xl">Lesson</h1><Loading label="Loading lesson…" /></Page></LearningFocus>;
  if (request.state === "error") return <LearningFocus destination={request.destination}><Page><h1 className="mt-8 text-2xl">Lesson unavailable</h1><LearningFailure error={request.error} retry={retry} /><Link to="/learning">Back to Learning</Link></Page></LearningFocus>;
  const detail = request.data;
  return <LearningFocus destination={request.destination}><Page width="narrow"><Link className="mt-6 inline-block text-accent hover:underline" to="/learning">Back to Learning</Link>
    <PageHeader title={detail.lesson.title} lede={detail.lesson.summary} />
    {catalog.loading && <Loading label="Loading prerequisite and follow-up links…" />}
    {catalog.error && <LearningFailure error="Prerequisite and follow-up links could not be loaded." retry={catalog.retry} />}
    <DeviceLesson key={request.destination} detail={detail} catalog={catalog.data} />
  </Page></LearningFocus>;
}

function LessonSession() {
  const { lessonId = "" } = useParams();
  const detail = useLearningLesson(lessonId), catalog = useLearningCatalog();
  return <LessonView {...detail} catalog={catalog} />;
}

export function LessonPage() {
  const owner = useLearningOwner();
  return <LessonSession key={owner} />;
}
