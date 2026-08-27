import { DeploymentStatus } from "@shared/enum/DeploymentStatus.enum";
import type { Deployment } from "@shared/interface/Deployment.interface";

interface PastDeploymentsPanelProps {
  pastDeployments: Deployment[];
}

export function PastDeploymentsPanel({
  pastDeployments,
}: PastDeploymentsPanelProps) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <h3 className="text-xs font-semibold text-gray-400 mb-2">
        Past Deployments
      </h3>
      {pastDeployments.length === 0 ? (
        <p className="text-xs text-gray-600">No past deployments</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {pastDeployments.map((pastDeployment) => (
            <div
              key={pastDeployment.id}
              className="text-xs flex items-center justify-between"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  pastDeployment.status === DeploymentStatus.COMPLETED
                    ? "bg-green-500"
                    : pastDeployment.status === DeploymentStatus.FAILED
                      ? "bg-red-500"
                      : pastDeployment.status === DeploymentStatus.RUNNING
                        ? "bg-blue-500 animate-pulse"
                        : "bg-gray-600"
                }`}
              />
              <span className="text-gray-400 truncate flex-1 ml-2">
                {new Date(pastDeployment.createdAt).toLocaleDateString()}
              </span>
              <span className="text-gray-500">
                {pastDeployment.resourceCount} resources
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
