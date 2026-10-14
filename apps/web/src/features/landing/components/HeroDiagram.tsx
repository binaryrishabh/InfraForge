import { HealthMark } from "@/ui/HealthMark";

// Card width in percent of the sheet; wide enough for "Database" at phone width.
const W = 20;
const NODES = [
  { id: "dns", type: "DNS", x: 2, y: 42 },
  { id: "lb", type: "Balancer", x: 27, y: 42 },
  { id: "vm1", type: "Server", x: 53, y: 18 },
  { id: "vm2", type: "Server", x: 53, y: 66 },
  { id: "db", type: "Database", x: 78, y: 42 },
];
const EDGES = [["dns", "lb"], ["lb", "vm1"], ["lb", "vm2"], ["vm1", "db"], ["vm2", "db"]] as const;

/* An illustrative sheet drawn with the product's own grammar: index-card nodes on
a drafting grid, a pinned prediction and the recorded outcome beside it. */
export function HeroDiagram() {
  const at = (id: string) => NODES.find((n) => n.id === id)!;
  return (
    <figure className="relative">
      <div className="if-paper-grid relative aspect-[4/3] max-sm:aspect-square overflow-hidden rounded-lg border border-line shadow-e2 [background-size:20px_20px]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {EDGES.map(([a, b]) => {
            const from = at(a), to = at(b);
            return <line key={`${a}${b}`} x1={from.x + W} y1={from.y} x2={to.x} y2={to.y} stroke="var(--if-ink-3)" strokeWidth="0.35" vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {NODES.map((node) => (
          <div key={node.id} className="absolute -translate-y-1/2 rounded-md border border-line-strong bg-raised px-1.5 py-1.5 shadow-e1 sm:px-2" style={{ left: `${node.x}%`, top: `${node.y}%`, width: `${W}%` }}>
            <p className="if-num truncate text-[10px] text-ink-3">{node.id}</p>
            <p className="truncate text-[11px] font-semibold text-ink sm:text-xs">{node.type}</p>
          </div>
        ))}
        <div className="absolute top-4 left-4 rotate-[-1.5deg] rounded-sm bg-marker px-3 py-2 text-[#17191D] shadow-e1">
          <p className="if-eyebrow !text-[#17191D]/70">Your prediction</p>
          <p className="text-sm font-semibold">Database runs hottest</p>
        </div>
        <div className="absolute right-4 bottom-4 rounded-md border border-line bg-raised px-3 py-2 shadow-e2">
          <p className="if-eyebrow">Recorded · second 45</p>
          <div className="mt-1 flex flex-col gap-0.5">
            <HealthMark value="healthy" size="sm" label="Overall healthy" />
            <span className="if-num text-xs text-ink-2">vm1 48% CPU · vm2 47% · db 33%</span>
            <span className="text-xs text-ink-3">The prediction did not match.</span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-sm text-ink-3">An illustration, not a recorded run: a prediction pinned beside what the run recorded.</figcaption>
    </figure>
  );
}
