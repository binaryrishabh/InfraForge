import { RESOURCE_TYPES } from "@shared/constants/RESOURCE_TYPES.constants";
import type { Resource } from "@shared/interface/Resource.interface";
import type { DeploymentStageResult } from "@shared/interface/DeploymentStageResult.interface";

export const runSecurityScan = (resources: Resource[]): DeploymentStageResult => {
  const issues: string[] = [];

  for(const resource of resources) {
    // Public Database check
    if(resource.type === RESOURCE_TYPES.Database && resource.public === true) {
      issues.push(`Database should not be publicly accessible`);
    }

    // Open SSH port check
    if(resource.openPorts?.includes(22) && resource.public === true) {
      issues.push(`${resource.type} exposes SSH (port 22) publicly`);
    }

    // Missing encryption on public resources
    if(resource.public === true && !resource.encryption) {
      issues.push(`${resource.type} is public without encryption`);
    }
  }

  if(issues.length === 0) {
    return {
      status: "passed",
      summary: "No security issues detected",
      details: { issues: [] }
    }
  }

  return {
    status: "warning", // Warn, don't block - better for learning
    summary: `${issues.length} security issues detected: ${issues.slice(0, 2).join("; ")}${issues.length > 2 ? "..." : ""}`,
    details: { issues }
  }
}