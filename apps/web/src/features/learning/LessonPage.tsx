import { Link, useParams } from "react-router-dom";
import type { LearningCatalog, LearningLessonDetail } from "@infraforge/contracts/learning";
import { useOpenChallenge } from "@/features/challenges/useOpenChallenge";
import { Button } from "@/ui/Button";
import { Loading, Notice, Page, PageHeader, Section } from "@/ui/Page";
import { Tag } from "@/ui/Tag";
import { activityLabel, availableLessons, KIND_LABEL, lessonMode, prerequisiteLessons } from "./discovery";
import { useDeviceLesson, useLearningCatalog, useLearningLesson } from "./hooks";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import type { DeviceLessonState } from "./deviceLocal";

export function LessonBody({ detail, catalog, local, storageAvailable, onLocal, onOpen, busy }: {
  detail: LearningLessonDetail; catalog: LearningCatalog | null; local: DeviceLessonState; storageAvailable: boolean;
  onLocal(value: DeviceLessonState): void; onOpen(id: string): void; busy: boolean;
}) {
  const { lesson, challenge, progress } = detail;
  const activity = activityLabel(lesson, progress);
  const ordered = catalog ? availableLessons(catalog).filter((l) => l.trackId === lesson.trackId) : [];
  const index = ordered.findIndex((l) => l.id === lesson.id);
  const next = index >= 0 ? ordered[index + 1] : null;
  const answer = lesson.check?.choices.find((c) => c.id === local.answer)?.id ?? null;
  const canOpen = lesson.kind === "executable-lab" && lesson.availability === "available" && challenge?.id === lesson.experiment.challengeId && challenge.executable;
  return <>
    <p className="mt-4 text-sm text-ink-3"><Tag>{KIND_LABEL[lesson.kind]}</Tag> · {lesson.level} · {lessonMode(lesson)}</p>
    {activity && <p className="mt-2 text-sm"><Tag>Server activity: {activity}</Tag></p>}
    <aside className="mt-4 text-sm" aria-label="Suggested prerequisites">
      <p>Prerequisites are advice, not locks.</p>
      {catalog ? <ul>{prerequisiteLessons(lesson, catalog).map(({ id, lesson: prerequisite }) => <li key={id}>{prerequisite
        ? <Link className="text-accent hover:underline" to={`/learning/lessons/${encodeURIComponent(id)}`}>{prerequisite.title}</Link>
        : `Prerequisite unavailable: ${id}`}</li>)}</ul> : <p>Prerequisite links are unavailable until the learning list loads.</p>}
    </aside>
    <Section title="Problem" className="mt-6">{lesson.problem.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>
    <Section title="Plain explanation" className="mt-6">{lesson.explanation.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>
    <Section title="Prediction prompt" className="mt-6"><p>{lesson.kind === "executable-lab"
      ? lesson.experiment.prediction ?? "Before running, predict what this design will do under the challenge's fixed conditions. Record your prediction in the existing challenge flow."
      : "Return to the problem. What would you expect to happen, and why? Say your reasoning before moving on."}</p></Section>
    {lesson.kind === "executable-lab" && <>
      <Section title="Experiment" className="mt-6">
        {canOpen ? <><p className="mb-3">Open “{challenge.title}” to design and record a prediction before starting an attempt.</p>
          <Button variant="primary" loading={busy} onClick={() => onOpen(lesson.experiment.challengeId)}>Open challenge lab</Button>
        </> : <Notice role="status">The linked challenge is unavailable for running. No experiment result is known.</Notice>}
      </Section>
      <Section title="Evidence to inspect" className="mt-6">
        <p>After a run is saved, inspect its report: the recorded inputs, each requirement and its evidence, and the prediction review. Missing measurements remain unknown. A terminal-second reading does not describe the whole run.</p>
        {activity && progress?.lastRunId ? <Link className="mt-3 inline-block text-accent hover:underline" to={`/runs/${encodeURIComponent(progress.lastRunId)}`}>Inspect the latest recorded attempt</Link>
          : <p className="mt-3 text-sm text-ink-3">No recorded attempt is linked here. No outcome is claimed.</p>}
      </Section>
    </>}
    <Section title="Limitations" className="mt-6">{lesson.limitations.map((p) => <p key={p} className="mb-3 text-ink-2">{p}</p>)}</Section>
    <Section title="Follow-up" className="mt-6"><p>Explain the idea in your own words and name one limitation.</p>
      {next ? <Link className="mt-3 inline-block text-accent hover:underline" to={`/learning/lessons/${encodeURIComponent(next.id)}`}>Next in track order: {next.title}</Link>
        : <Link className="mt-3 inline-block text-accent hover:underline" to="/learning">Find another lesson</Link>}
    </Section>
    <Section title="Check question" className="mt-6">
      {lesson.check ? <fieldset aria-describedby="check-help">
        <legend className="font-semibold">{lesson.check.question}</legend>
        <p id="check-help" className="mt-2 text-sm text-ink-3">Choose an answer for an immediate explanation. This is a device-local check, not server progress or mastery.</p>
        {lesson.check.choices.map((choice) => <label key={choice.id} className="mt-3 flex items-center gap-2">
          <input type="radio" name={`check-${lesson.id}`} value={choice.id} checked={answer === choice.id} onChange={() => onLocal({ ...local, answer: choice.id })} />{choice.text}
        </label>)}
        {answer && <p role="status" aria-live="polite" className="mt-4">{answer === lesson.check.correctChoiceId ? "That matches the explanation. " : "Revisit the explanation. "}{lesson.check.explanation}</p>}
      </fieldset> : <p>This lesson has no check question. Try explaining the problem in your own words.</p>}
    </Section>
    <div className="mt-6 border-t border-line pt-5">
      <Button aria-pressed={local.read} onClick={() => onLocal({ ...local, read: !local.read })}>{local.read ? "Remove read mark" : "Mark as read"}</Button>
      <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-3">{!storageAvailable ? "Could not save on this device. Your choices are available for this visit only."
        : local.read || answer ? "Reading mark and check answers: saved on this device." : "Reading marks and check answers can be saved on this device."} These are personal notes, not server progress or mastery.</p>
    </div>
  </>;
}

function DeviceLesson({ detail, catalog }: { detail: LearningLessonDetail; catalog: LearningCatalog | null }) {
  const local = useDeviceLesson(detail.lesson.id, detail.lesson.contentVersion);
  const { open, busy } = useOpenChallenge();
  return <LessonBody detail={detail} catalog={catalog} local={local.value} storageAvailable={local.available} onLocal={local.update} onOpen={(id) => void open(id)} busy={busy !== null} />;
}

export function LessonView({ data, loading, error, retry, catalog }: LearningRequest<LearningLessonDetail> & { catalog: LearningRequest<LearningCatalog> }) {
  if (loading) return <Page><h1 className="mt-8 text-2xl">Lesson</h1><Loading label="Loading lesson…" /></Page>;
  if (error || !data) return <Page><h1 className="mt-8 text-2xl">Lesson unavailable</h1><LearningFailure error={error ?? "This lesson could not be loaded."} retry={retry} /><Link to="/learning">Back to Learning</Link></Page>;
  return <Page width="narrow"><Link className="mt-6 inline-block text-accent hover:underline" to="/learning">Back to Learning</Link>
    <PageHeader title={data.lesson.title} lede={data.lesson.summary} />
    {catalog.loading && <Loading label="Loading prerequisite and follow-up links…" />}
    {catalog.error && <LearningFailure error="Prerequisite and follow-up links could not be loaded." retry={catalog.retry} />}
    <DeviceLesson key={`${data.lesson.id}:${data.lesson.contentVersion}`} detail={data} catalog={catalog.data} />
  </Page>;
}

export function LessonPage() {
  const { lessonId = "" } = useParams();
  const detail = useLearningLesson(lessonId), catalog = useLearningCatalog();
  return <LessonView {...detail} catalog={catalog} />;
}
