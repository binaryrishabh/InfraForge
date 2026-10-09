export const DEPLOYMENT_STAGES_NAMES = [
    "Validate",
    "SecurityScan",
    "CostEstimate"
] as const;
export type DeploymentStagesNamesType = (typeof DEPLOYMENT_STAGES_NAMES)[number];