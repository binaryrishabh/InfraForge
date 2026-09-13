interface CardHeroMetricProps {
  value: number;
  unit: string;
}

/* The one dominant number per card (Decision 42): mono tabular hero + caps
unit. Unit lifted one size step and one tone brighter (9px #677185 ->
10px #AAB4C5) so "rps / qps" reads without squinting. */
export function CardHeroMetric({ value, unit }: CardHeroMetricProps) {
  return (
    <div className="flex items-baseline gap-1.5 mb-1.5">
      <span className="text-[18px] font-mono font-semibold text-[#EDF1F7] tabular-nums leading-none">
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] font-mono uppercase tracking-wider text-[#AAB4C5]">
        {unit}
      </span>
    </div>
  );
}