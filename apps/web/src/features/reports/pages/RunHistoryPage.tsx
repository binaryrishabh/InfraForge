import { useCallback, useState } from "react";
import { getRunHistory, type RunKind } from "@/api/reports.api";
import { useRequest } from "@/api/useRequest";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Page, PageHeader } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { HistoryContent } from "../components/RunList";
import { CompareSelection } from "../components/RunSelection";
import { toggleRun } from "../selection";

const EMPTY: Record<RunKind, string> = {
  all: "Run a saved design or attempt a challenge, then come back here to read what the simulator recorded.",
  challenge: "No challenge attempts yet. Pick a challenge, predict, and run it.",
  freeform: "No freeform runs yet. Open the designer and run a design with traffic of your choosing.",
};

function HistoryPage({ kind, cursor, onPage, selected, onToggle }: { kind: RunKind; cursor: string | undefined; onPage: (c: string | undefined) => void; selected: string[]; onToggle: (id: string) => void }) {
  const load = useCallback(() => getRunHistory(50, cursor, kind), [cursor, kind]);
  const request = useRequest(load, "Run history could not be loaded. Your session may have ended.");
  const next = request.data?.nextCursor;
  return (
    <>
      <HistoryContent {...request} runs={request.data?.runs ?? []} selected={selected} onToggle={onToggle} emptyText={EMPTY[kind]} />
      {(cursor || next) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {cursor && <Button size="sm" variant="ghost" onClick={() => onPage(undefined)}>Newest runs</Button>}
          {next && <Button size="sm" variant="secondary" onClick={() => onPage(next)}>Older runs</Button>}
        </div>
      )}
    </>
  );
}

function History() {
  const [kind, setKind] = useState<RunKind>("all");
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <div className="sticky top-[101px] z-10 -mx-4 flex flex-col gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:-mx-8 lg:px-8 md:top-14">
        <Segmented label="Show runs" value={kind} onChange={(value) => { setKind(value); setCursor(undefined); }}
          options={[{ value: "all", label: "All" }, { value: "challenge", label: "Challenge attempts" }, { value: "freeform", label: "Freeform" }]} />
        <CompareSelection selected={selected} />
      </div>
      <div className="mt-2">
        {/* Each page starts empty; an older response cannot replace the current page. */}
        <HistoryPage key={`${kind}:${cursor ?? "newest"}`} kind={kind} cursor={cursor} onPage={setCursor} selected={selected} onToggle={(id) => setSelected((s) => toggleRun(s, id))} />
      </div>
    </>
  );
}

export function RunHistoryPage() {
  const userId = useAuthStore((s) => s.user?.id);
  return (
    <Page>
      <PageHeader eyebrow="Runs" title="What ran, and what was recorded." lede="Every run keeps its inputs, its actions and its final evidence. Open one to read it, or select two to compare them." />
      <History key={userId} />
    </Page>
  );
}
