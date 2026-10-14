import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { StatusMark } from "@/ui/StatusMark";
import { useCanvasStore } from "../../store/canvasStore";

/* Structural readiness, computed locally with the same rules the Validate gate
uses. Cost and the security scan are recorded by the gates when a run starts. */
export function ChecksPanel() {
  const resources = useCanvasStore((s) => s.resources);
  const lines = useCanvasStore((s) => s.connectionLines);
  const readiness = validateDeploymentReadiness(resources, lines);
  return (
    <div className="px-4 py-4">
      {resources.length === 0 ? <p className="text-sm text-ink-3">Add resources to see whether the design can run.</p> : (
        <>
          <StatusMark kind={readiness.valid ? "ok" : "problem"} label={readiness.valid ? "Ready to run" : `${readiness.errors.length} ${readiness.errors.length === 1 ? "problem blocks" : "problems block"} a run`} />
          {readiness.errors.length > 0 && <ul className="mt-3 flex flex-col gap-2">{readiness.errors.map((e) => <li key={e} className="border-l-2 border-fail pl-2.5 text-sm text-ink">{e}</li>)}</ul>}
          {readiness.warnings.length > 0 && (
            <>
              <h3 className="mt-5 text-[13px] font-semibold text-ink">Warnings <span className="font-normal text-ink-3">(do not block)</span></h3>
              <ul className="mt-2 flex flex-col gap-2">{readiness.warnings.map((w) => <li key={w} className="border-l-2 border-warn pl-2.5 text-sm text-ink-2">{w}</li>)}</ul>
            </>
          )}
        </>
      )}
      <p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">When a run starts, three gates record evidence: Validate, SecurityScan (public exposure, SSH, encryption) and CostEstimate (monthly model estimate).</p>
    </div>
  );
}
