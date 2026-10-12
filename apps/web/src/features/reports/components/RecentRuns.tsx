import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getRunHistory } from "../../../api/reports.api";
import { useReportRequest } from "../useReportRequest";
import { HistoryContent } from "./RunList";

export function RecentRuns() {
  const load = useCallback(() => getRunHistory(5), []);
  const request = useReportRequest(load);
  return <section className="bg-[#1C1F26] border border-[#2A2E37] rounded-xl overflow-hidden text-[#EDEEF0]">
    <div className="p-4 border-b border-[#2A2E37] flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Recent runs</h2><Link to="/reports" className="text-sm text-[#4FA89B] hover:underline">All reports →</Link></div>
    <HistoryContent {...request} runs={request.data?.runs ?? []} />
  </section>;
}
