interface DesignCardFooterProps {
  showPool: boolean;
  poolText: string;
  instanceText: string;
}

/* Design-state footer pinned to the bottom of the compact tile: pool token
only when the resource anchors an autoscaling pool, instance token right.
Both tokens lifted one size step and one tone brighter (pool #677185 ->
#AAB4C5, instance #AAB4C5 -> #EDF1F7) so "pool …" and "generic / sku" read. */
export function DesignCardFooter({ showPool, poolText, instanceText }: DesignCardFooterProps) {
  return (
    <div className="flex items-end justify-between gap-2 mt-auto pt-2">
      {showPool ? (
        <span className="text-[11px] font-mono text-[#AAB4C5]">{poolText}</span>
      ) : (
        <span />
      )}
      <span className="text-[11px] font-mono text-[#EDF1F7]">{instanceText}</span>
    </div>
  );
}