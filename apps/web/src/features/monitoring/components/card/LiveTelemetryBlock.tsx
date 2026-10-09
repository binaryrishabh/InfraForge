import { getBarColor } from "./healthStyles";

interface LiveTelemetryBlockProps {
  cpu: number;
  memory: number;
  rps?: number;
  connections?: number;
  isRestarting: boolean;
}

/* Live-state body: CPU/MEM 1px bars with inline %, RPS/CONN row, restart
line. Uniform internal rhythm across every node type (spacing fix). */
export function LiveTelemetryBlock({ cpu, memory, rps, connections, isRestarting }: LiveTelemetryBlockProps) {
  return (
    <>
      <div className="mb-1.5">
        <div className="flex justify-between mb-0.5">
          <span className="text-[9px] font-mono text-[#5A5F6B]">CPU</span>
          <span className="text-[10px] font-mono text-[#EDEEF0] tabular-nums">{cpu.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-sm bg-[#2A2E37] overflow-hidden">
          <div
            className={`h-full rounded-sm transition-all duration-500 ${getBarColor(cpu)}`}
            style={{ width: `${Math.min(100, cpu)}%` }}
          />
        </div>
      </div>
      <div className="mb-1.5">
        <div className="flex justify-between mb-0.5">
          <span className="text-[9px] font-mono text-[#5A5F6B]">MEM</span>
          <span className="text-[10px] font-mono text-[#EDEEF0] tabular-nums">{memory.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-sm bg-[#2A2E37] overflow-hidden">
          <div
            className={`h-full rounded-sm transition-all duration-500 ${getBarColor(memory)}`}
            style={{ width: `${Math.min(100, memory)}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1.5">
        {rps !== undefined && (
          <div className="flex gap-1.5">
            <span className="text-[#5A5F6B]">RPS</span>
            <span className="text-[#EDEEF0]">{rps}</span>
          </div>
        )}
        {connections !== undefined && (
          <div className="flex gap-1.5">
            <span className="text-[#5A5F6B]">CONN</span>
            <span className="text-[#EDEEF0]">{connections}</span>
          </div>
        )}
      </div>
      {isRestarting && (
        <div className="text-[10px] font-mono font-semibold text-[#C98A4B] text-center mb-0.5">
          RESTARTING
        </div>
      )}
    </>
  );
}