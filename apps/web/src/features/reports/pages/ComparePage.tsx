import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { getComparison } from "../../../api/reports.api";
import { useAuthStore } from "../../auth/store/auth.store";
import { useReportRequest } from "../useReportRequest";
import { CompareContent } from "../components/CompareView";

function Compare({ a, b }: { a: string; b: string }) {
  const load = useCallback(() => getComparison(a, b), [a, b]);
  return <CompareContent {...useReportRequest(load)} />;
}
export function ComparePage() {
  const [query] = useSearchParams();
  const owner = useAuthStore((s) => s.user?.id);
  const a = query.get("a") ?? "", b = query.get("b") ?? "";
  return <main className="flex-1 min-w-0 overflow-y-auto bg-[#14161A] p-4 sm:p-8 text-[#EDEEF0]"><div className="max-w-5xl mx-auto"><Compare key={`${owner}:${a}:${b}`} a={a} b={b} /></div></main>;
}
