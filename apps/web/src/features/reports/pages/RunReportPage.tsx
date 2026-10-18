import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { getRunReport } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Page } from "@/ui/Page";
import { ReportContent } from "../components/ReportContent";

function Report({ id }: { id: string }) {
  const load = useCallback(() => getRunReport(id), [id]);
  return <ReportContent {...useRequest(load, "The recorded run could not be loaded. It may not exist, or your session may have ended.")} />;
}

export function RunReportPage() {
  const { deploymentId = "" } = useParams();
  const userId = useAuthStore((s) => s.user?.id);
  return <Page width="wide"><Report key={`${userId}:${deploymentId}`} id={deploymentId} /></Page>;
}
