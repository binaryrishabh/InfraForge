import { Link } from "react-router-dom";
import type { RunReport } from "@infraforge/contracts/reports";
import { Button } from "@/ui/Button";
import { Loading, Notice } from "@/ui/Page";
import { ReportView } from "./ReportView";

export function ReportContent({ loading, error, data, retry }: { loading: boolean; error: string | null; data: RunReport | null; retry: () => void }) {
  if (loading) return <Loading label="Loading recorded report…" />;
  if (error || !data) return (
    <div role="alert" className="mt-10 flex flex-col items-start gap-3">
      <Notice tone="fail">{error ?? "This report is unavailable."}</Notice>
      <Button size="sm" onClick={retry}>Try again</Button>
      <Link className="text-sm font-medium text-accent hover:underline" to="/runs">Back to runs</Link>
    </div>
  );
  return <ReportView report={data} onStopped={retry} />;
}
