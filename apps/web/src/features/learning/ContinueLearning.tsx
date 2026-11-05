import type { LearningCatalog } from "@infraforge/contracts/learning";
import { learningNextStep } from "@/features/dashboard/nextStep";
import { ButtonLink } from "@/ui/Button";
import { Loading, Section } from "@/ui/Page";
import { LearningFailure, type LearningRequest } from "./LearningPage";
import { requestView } from "./viewModels";

export function ContinueLearning({ data, loading, error, retry }: LearningRequest<LearningCatalog>) {
  const request = requestView({ data, loading, error }, "The learning suggestion could not be loaded.");
  if (request.state === "loading") return <Loading label="Loading learning suggestion…" />;
  if (request.state !== "ready") return <LearningFailure error="The learning suggestion could not be loaded." retry={retry} />;
  const next = learningNextStep(request.data);
  return <Section title="Continue learning" className="mt-8">
    {next ? <><p className="font-semibold">{next.lesson.title}</p><p className="mt-2 text-sm text-ink-2">{next.reason}</p>
      <ButtonLink className="mt-3" to={`/learn/lessons/${encodeURIComponent(next.lesson.id)}`}>Continue learning</ButtonLink>
    </> : <><p>No learning suggestion is available.</p><ButtonLink className="mt-3" to="/learn">Browse Learning</ButtonLink></>}
  </Section>;
}
