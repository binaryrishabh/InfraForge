import { useEffect, useRef } from "react";
import { useSimulationStore } from "../store/simulationStore";

const severityColor: Record<string, string> = {
  info: "text-[#5B8CFF]",
  warn: "text-[#F5A524]",
  error: "text-[#F0564A]"
};

export function LiveLogsPanel() {
  const logs = useSimulationStore((s) => s.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [logs]);

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400">Live Logs</h3>
        <span className="text-[9px] font-mono text-[#677185]">{logs.length} entries</span>
      </div>
      <div ref={scrollRef} className="space-y-1 max-h-48 overflow-y-auto font-mono">
        {logs.length === 0 ? (
          <p className="text-[10px] text-[#677185]">Waiting for events…</p>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="text-[10px] leading-relaxed">
              <span className="text-[#677185]">{new Date(log.timestamp).toLocaleTimeString()}</span>{" "}
              <span className={`${severityColor[log.severity]} uppercase`}>[{log.severity}]</span>{" "}
              <span className="text-[#AAB4C5]">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}