import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { HYPOTHESIS_MAX } from "@infraforge/contracts/challenges";
import type { RunReport } from "@infraforge/contracts/reports";
import { openImprovementWorkspace } from "@/api/challenges.api";
import { errorMessage } from "@/api/errorMessage";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { installDesign } from "@/features/canvas/designLoader";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { Field, Textarea } from "@/ui/Field";
import { Notice } from "@/ui/Page";
import type { ChallengeImprovementContext } from "../learningContext";

export function BeginImprovement({ report }: { report: RunReport }) {
  const [open, setOpen] = useState(false), [hypothesis, setHypothesis] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [replace, setReplace] = useState(false);
  const inFlight = useRef(false), navigate = useNavigate();
  const unsaved = useCanvasStore((s) => !s.currentLayoutSaved && s.resources.length > 0);
  const active = useCanvasStore((s) => !!s.activeDeploymentId && (s.liveMode || s.isDeploying));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !hypothesis.trim() || (unsaved && !replace) || active || !report.challenge) return;
    inFlight.current = true; setBusy(true); setError(null);
    const ownerId = useAuthStore.getState().user?.id;
    const before = useCanvasStore.getState();
    try {
      const design = await openImprovementWorkspace(report.challenge.challengeId, report.run.id);
      if (!ownerId || useAuthStore.getState().user?.id !== ownerId) throw new Error("Your session changed.");
      // A late response must not discard work begun while this request was pending.
      const canvas = useCanvasStore.getState();
      if (canvas.currentLayoutId !== before.currentLayoutId || canvas.resources !== before.resources || canvas.connectionLines !== before.connectionLines) throw new Error("Your canvas changed while opening the experiment. The copied design remains in Designs.");
      if (canvas.activeDeploymentId && (canvas.liveMode || canvas.isDeploying)) throw new Error("Return to the active run first. The copied design remains in Designs.");
      installDesign(design);
      const focus = report.guidedReview?.cues.find((c) => c.resourceId)?.resourceId;
      if (focus && design.layout.resources?.some((r) => r.id === focus)) {
        useCanvasStore.getState().setSelectedResourceId(focus); useCanvasStore.getState().setSelectedResourceForConfigId(focus);
      }
      const context: ChallengeImprovementContext = { ownerId, designId: design.id, sourceRunId: report.run.id,
        challengeId: report.challenge.challengeId, version: report.challenge.version, hypothesis: hypothesis.trim() };
      navigate("/design", { state: { challengeImprovement: context } });
    } catch (err) { setError(errorMessage(err, "The source attempt could not be opened safely.")); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    <Button variant="primary" disabled={!report.guidedReview?.canImprove} onClick={() => setOpen(true)}>Plan one change</Button>
    {!report.guidedReview?.canImprove && <p className="mt-2 text-sm text-ink-3">{report.guidedReview?.unavailableReason ?? "This source is not available for an improvement experiment."}</p>}
    <Dialog open={open} onOpenChange={setOpen} busy={busy} guarded title="What will you test next?" eyebrow="Your next experiment"
      description="Write your own hypothesis before editing. The new workspace copies this attempt's starting design; your existing designs stay saved."
      footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Keep reading</Button><Button type="submit" form="learning-plan" variant="primary" loading={busy} disabled={!hypothesis.trim() || active || (unsaved && !replace)}>Open experiment workspace</Button></>}>
      <form id="learning-plan" onSubmit={submit} className="space-y-4">
        <Field label="What one change do you want to test, and what do you expect?" hint={`${hypothesis.length}/${HYPOTHESIS_MAX} characters. You choose the hypothesis; InfraForge does not supply a solution.`}>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} maxLength={HYPOTHESIS_MAX} required rows={4} />}
        </Field>
        <p className="text-xs text-ink-3">Source attempt: {report.run.id}. Challenge version, workload, seed, scheduled fault and evaluation time stay fixed. Predict again before the new run.</p>
        {active && <Notice tone="warn">A run is still open in the workspace. Finish or leave it before opening another design.</Notice>}
        {unsaved && <label className="flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />Replace my current unsaved canvas. Those edits will be lost.</label>}
        {error && <Notice tone="fail" role="alert">{error}</Notice>}
      </form>
    </Dialog>
  </>;
}
