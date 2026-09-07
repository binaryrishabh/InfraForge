import type { Deployment } from "@shared/interface/Deployment.interface";
import { PANEL_SHELL_CLASS } from "@/theme/resourceCategoryHues";

interface SecurityIssuesPanelProps {
  deployment: Deployment;
}

export function SecurityIssuesPanel({ deployment }: SecurityIssuesPanelProps) {
  // Stage lookup by name — resilient to the stage list shrinking to three.
  const securityStage = deployment.stages?.find(
    (stage) => stage.name === "SecurityScan",
  );
  if (!securityStage?.details) return null;

  const issues = securityStage.details.issues as string[] | undefined;

  return (
    <div className={PANEL_SHELL_CLASS}>
      <h3 className="text-[10px] uppercase tracking-wider text-[#677185] font-semibold mb-2">
        Security Issues
      </h3>
      {!issues || issues.length === 0 ? (
        <p className="text-xs text-green-400">No issues detected</p>
      ) : (
        issues.map((issue, i) => (
          <p key={i} className="text-xs text-amber-400 py-1">
            ⚠ {issue}
          </p>
        ))
      )}
    </div>
  );
}