import type { Deployment } from "@shared/interface/Deployment.interface";
import { PANEL_SHELL_CLASS } from "@/theme/resourceCategoryHues";

interface CostBreakdownPanelProps {
  deployment: Deployment;
}

interface CostLineItem {
  resourceId: string;
  type: string;
  provider?: string;
  skuId?: string;
  skuLabel?: string;
  monthlyUsd: number;
}

export function CostBreakdownPanel({ deployment }: CostBreakdownPanelProps) {
  // Stage lookup by name — resilient to the stage list shrinking to three.
  const costStage = deployment.stages?.find(
    (stage) => stage.name === "CostEstimate",
  );
  if (!costStage?.details) return null;

  const lineItems = costStage.details.lineItems as CostLineItem[] | undefined;
  const breakdown = costStage.details.breakdown as
    | Record<string, number>
    | undefined;
  const monthlyEstimate = costStage.details.monthlyEstimate as
    | number
    | undefined;

  return (
    <div className={PANEL_SHELL_CLASS}>
      <h3 className="text-[10px] uppercase tracking-wider text-[#677185] font-semibold mb-2">
        Cost Breakdown
      </h3>
      {lineItems && lineItems.length > 0 ? (
        <>
          {lineItems.map((item) => (
            <div
              key={item.resourceId}
              className="flex justify-between text-xs py-1 gap-2"
            >
              <span className="truncate">
                {item.skuLabel ?? `${item.type} (${item.resourceId})`}
              </span>
              <span className="text-green-400 shrink-0">
                ${item.monthlyUsd.toFixed(2)}
              </span>
            </div>
          ))}
          {monthlyEstimate !== undefined && (
            <div className="flex justify-between text-xs py-1.5 mt-1 border-t border-[#1F2633]">
              <span className="text-[#AAB4C5]">Estimated monthly</span>
              <span className="text-green-400 font-semibold">
                ${monthlyEstimate.toFixed(2)}
              </span>
            </div>
          )}
        </>
      ) : breakdown ? (
        Object.entries(breakdown).map(([type, cost]) => (
          <div key={type} className="flex justify-between text-xs py-1">
            <span>{type}</span>
            <span className="text-green-400">${cost}</span>
          </div>
        ))
      ) : null}
    </div>
  );
}