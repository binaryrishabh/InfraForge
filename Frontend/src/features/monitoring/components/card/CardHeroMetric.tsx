interface CardHeroMetricProps {
  value: number;
  unit: string;
}

/* The one dominant number per card (Decision 42): mono tabular hero + caps
unit on the secondary/tertiary ramp. */
export function CardHeroMetric({ value, unit }: CardHeroMetricProps) {
  return (
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <span className="text-[18px] font-mono font-semibold text-[#EDEEF0] tabular-nums leading-none">
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#8B909C]">
        {unit}
      </span>
    </div>
  );
}