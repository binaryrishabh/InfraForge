import { getBarColor } from "./healthStyles";

interface LiveTelemetryBlockProps {
  cpu: number;
  memory: number;
  rps?: number;
  connections?: number;
  isRestarting: boolean;
}

/* Live-state body: CPU/MEM 1px bars with inline %, RPS/CONN row, restart line. */
export function LiveTelemetryBlock({ cpu, memory, rps, connections, isRestarting }: LiveTelemetryBlockProps) {
  return (
    <>
      <div className="mb-1">
        <div className="flex justify-between mb-0.5">
          <span className="text-[9px] font-mono text-[#677185]">CPU</span>
          <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{cpu.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getBarColor(cpu)}`}
            style={{ width: `${Math.min(100, cpu)}%` }}
          />
        </div>
      </div>
      <div className="mb-1.5">
        <div className="flex justify-between mb-0.5">
          <span className="text-[9px] font-mono text-[#677185]">MEM</span>
          <span className="text-[10px] font-mono text-[#EDF1F7] tabular-nums">{memory.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-full bg-[#1F2633] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getBarColor(memory)}`}
            style={{ width: `${Math.min(100, memory)}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1.5">
        {rps !== undefined && (
          <div className="flex gap-1.5">
            <span className="text-[#677185]">RPS</span>
            <span className="text-[#EDF1F7]">{rps}</span>
          </div>
        )}
        {connections !== undefined && (
          <div className="flex gap-1.5">
            <span className="text-[#677185]">CONN</span>
            <span className="text-[#EDF1F7]">{connections}</span>
          </div>
        )}
      </div>
      {isRestarting && (
        <div className="text-[10px] font-mono font-semibold text-amber-400 text-center mb-0.5">
          RESTARTING
        </div>
      )}
    </>
  );
}