interface DesignCardFooterProps {
  showPool: boolean;
  poolText: string;
  instanceText: string;
}

/* Design-state footer pinned to the bottom of the compact tile: pool token
only when the resource anchors an autoscaling pool, instance token right. */
export function DesignCardFooter({ showPool, poolText, instanceText }: DesignCardFooterProps) {
  return (
    <div className="flex items-end justify-between gap-2 mt-auto pt-2">
      {showPool ? (
        <span className="text-[11px] font-mono text-[#8B909C]">{poolText}</span>
      ) : (
        <span />
      )}
      <span className="text-[11px] font-mono text-[#EDEEF0]">{instanceText}</span>
    </div>
  );
}