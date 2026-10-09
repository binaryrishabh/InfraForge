export interface DeploymentStageResult {
  status: "passed" | "warning" | "failed";
  summary: string;
  details: Record<string, any>;
}