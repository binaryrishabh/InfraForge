import { validateDeploymentReadiness } from "@infraforge/domain/validation";
import { StatusMark } from "@/ui/StatusMark";
import { useCanvasStore } from "../../store/canvasStore";

/* Local structural checks only. The backend Validate gate checks Model 2
execution eligibility before a run starts. */
export function ChecksPanel() {
  const resources = useCanvasStore((s) => s.resources);
  const lines = useCanvasStore((s) => s.connectionLines);
  const readiness = validateDeploymentReadiness(resources, lines);
  return (
    <div className="px-4 py-4">
      {resources.length === 0 ? <p className="text-sm text-ink-3">Add resources to see whether the design can run.</p> : (
        <>
          <StatusMark kind={readiness.valid ? "ok" : "problem"} label={readiness.valid ? "Ready for validation" : `${readiness.errors.length} ${readiness.errors.length === 1 ? "problem blocks" : "problems block"} a run`} />
          {readiness.errors.length > 0 && <ul className="mt-3 flex flex-col gap-2">{readiness.errors.map((e) => <li key={e} className="border-l-2 border-fail pl-2.5 text-sm text-ink">{e}</li>)}</ul>}
          {readiness.warnings.length > 0 && (
            <>
              <h3 className="mt-5 text-[13px] font-semibold text-ink">Warnings <span className="font-normal text-ink-3">(do not block)</span></h3>
              <ul className="mt-2 flex flex-col gap-2">{readiness.warnings.map((w) => <li key={w} className="border-l-2 border-warn pl-2.5 text-sm text-ink-2">{w}</li>)}</ul>
            </>
          )}
        </>
      )}
      <p className="mt-5 border-t border-line pt-3 text-xs leading-relaxed text-ink-3">Before a run starts, Validate checks whether Model 2 can execute the saved design. SecurityScan checks public exposure, SSH and encryption; CostEstimate records the monthly model estimate.</p>
    </div>
  );
}
