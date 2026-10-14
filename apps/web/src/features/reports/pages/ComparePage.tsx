import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { getComparison } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Page } from "@/ui/Page";
import { CompareContent } from "../components/CompareView";

function Compare({ a, b }: { a: string; b: string }) {
  const load = useCallback(() => getComparison(a, b), [a, b]);
  return <CompareContent {...useRequest(load, "The comparison could not be loaded. Check that both runs exist and are yours.")} />;
}

export function ComparePage() {
  const [query] = useSearchParams();
  const owner = useAuthStore((s) => s.user?.id);
  const a = query.get("a") ?? "", b = query.get("b") ?? "";
  return <Page className="!max-w-[1000px]"><Compare key={`${owner}:${a}:${b}`} a={a} b={b} /></Page>;
}
