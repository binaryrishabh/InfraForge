import { DEPLOYMENT_STAGES_NAMES } from "@shared/constants/DEPLOYMENT_STAGES_NAMES.constants";
import type { Deployment } from "@shared/types/Deployment.types";

interface SecurityIssuesPanelProps {
  deployment: Deployment;
}

export function SecurityIssuesPanel({ deployment }: SecurityIssuesPanelProps) {
  const securityStage = deployment.stages?.find(
    (stage) => stage.name === DEPLOYMENT_STAGES_NAMES[5],
  );
  if (!securityStage?.details) return null;
  const issues = securityStage.details.issues as string[] | undefined;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-gray-400 mb-2">
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