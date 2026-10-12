import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { getRunReport } from "../../../api/reports.api";
import { useAuthStore } from "../../auth/store/auth.store";
import { useReportRequest } from "../useReportRequest";
import { ReportContent } from "../components/ReportContent";

function Report({ id }: { id: string }) {
  const load = useCallback(() => getRunReport(id), [id]);
  const request = useReportRequest(load);
  return <ReportContent {...request} />;
}

export function RunReportPage() {
  const { deploymentId = "" } = useParams();
  const userId = useAuthStore((s) => s.user?.id);
  return <main className="flex-1 overflow-y-auto bg-[#14161A] p-5 sm:p-8 text-[#EDEEF0]"><div className="max-w-4xl mx-auto"><Report key={`${userId}:${deploymentId}`} id={deploymentId} /></div></main>;
}
