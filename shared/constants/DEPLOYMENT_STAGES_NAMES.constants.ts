/* Three REAL gates. The nine-stage theater is retired (Decision 27/32):
Validate runs graph traversal, SecurityScan runs real rules,
CostEstimate runs real SKU math. Nothing sleeps, nothing pretends. */
export const DEPLOYMENT_STAGES_NAMES = [
    "Validate",
    "SecurityScan",
    "CostEstimate"
] as const;
export type DeploymentStagesNamesType = (typeof DEPLOYMENT_STAGES_NAMES)[number];