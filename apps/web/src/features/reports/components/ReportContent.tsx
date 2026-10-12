import { Link } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { ReportView } from "./ReportView";

export function ReportContent({ loading, error, data, retry }: {
  loading: boolean; error: string | null; data: RunReport | null; retry: () => void;
}) {
  if (loading) return <p role="status">Loading recorded report…</p>;
  if (error || !data) return <div role="alert" className="space-y-4">
    <p>{error ?? "This report is unavailable."}</p>
    <button className="text-[#4FA89B] underline" onClick={retry}>Try again</button>
    <p><Link className="text-[#4FA89B] underline" to="/reports">Back to run history</Link></p>
  </div>;
  return <ReportView report={data} />;
}
