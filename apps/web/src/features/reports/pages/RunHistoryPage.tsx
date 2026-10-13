import { useCallback, useState } from "react";
import { getRunHistory } from "../../../api/reports.api";
import { useAuthStore } from "../../auth/store/auth.store";
import { useReportRequest } from "../useReportRequest";
import { HistoryContent } from "../components/RunList";
import { CompareSelection } from "../components/RunSelection";
import { toggleRun } from "../selection";

function HistoryRequest({ cursor, onPage, selected, onToggle }: { cursor: string | undefined; onPage: (cursor: string | undefined) => void; selected: string[]; onToggle: (id: string) => void }) {
  const load = useCallback(() => getRunHistory(50, cursor), [cursor]);
  const request = useReportRequest(load);
  const nextCursor = request.data?.nextCursor;
  return <>
    <HistoryContent {...request} runs={request.data?.runs ?? []} selected={selected} onToggle={onToggle} />
    <div className="flex flex-wrap gap-4 p-4">
      {cursor && <button className="text-[#4FA89B] underline" onClick={() => onPage(undefined)}>Newest runs</button>}
      {nextCursor && <button className="text-[#4FA89B] underline" onClick={() => onPage(nextCursor)}>Older runs</button>}
    </div>
  </>;
}

function History() {
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  // Each page starts empty; an older request cannot replace the current page.
  return <><CompareSelection selected={selected} /><HistoryRequest key={cursor ?? "newest"} cursor={cursor} onPage={setCursor} selected={selected} onToggle={(id) => setSelected((s) => toggleRun(s, id))} /></>;
}

export function RunHistoryPage() {
  const userId = useAuthStore((s) => s.user?.id);
  return <main className="flex-1 overflow-y-auto bg-[#14161A] p-5 sm:p-8 text-[#EDEEF0]">
    <div className="max-w-4xl mx-auto space-y-6">
      <div><h1 className="text-2xl font-semibold">Run history</h1><p className="text-sm text-[#8B909C] mt-2">What happened, what the simulator recorded, and what remains unknown.</p></div>
      <div className="rounded-xl border border-[#2A2E37] bg-[#1C1F26]"><History key={userId} /></div>
    </div>
  </main>;
}
