import type { ChallengeBrief, ChallengePreflight } from "@infraforge/contracts/challenges";
import { Tabs, TabPanel } from "@/ui/Tabs";
import { Loading, Notice } from "@/ui/Page";
import { Button } from "@/ui/Button";
import { ChallengeBriefPanel } from "@/features/challenges/components/ChallengeBriefPanel";
import { useCanvasStore } from "../../store/canvasStore";
import { Inspector } from "../inspector/Inspector";
import { ChecksPanel } from "./ChecksPanel";

export type SideTab = "brief" | "inspect" | "checks";

interface BriefState { data: ChallengeBrief | null; loading: boolean; error: string | null; retry: () => void }

/* The context column: the challenge brief (when the design is a challenge
workspace), the inspector for the selection, and readiness checks. */
export function SidePanel({ tab, onTab, brief, preflight, preflightError, idBase }: {
  tab: SideTab; onTab: (tab: SideTab) => void; brief: BriefState | null; preflight: ChallengePreflight | null; preflightError: boolean; idBase: string;
}) {
  const selected = useCanvasStore((s) => s.resources.find((r) => r.id === s.selectedResourceForConfigId));
  const workspaceVersion = useCanvasStore((s) => s.currentChallengeVersion);
  const designId = useCanvasStore((s) => s.currentLayoutId);
  const items = [
    ...(brief ? [{ id: "brief" as const, label: "Brief" }] : []),
    { id: "inspect" as const, label: "Inspect" },
    { id: "checks" as const, label: "Checks" },
  ];
  const active = items.some((i) => i.id === tab) ? tab : items[0]!.id;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs idBase={idBase} label="Design details" items={items} value={active} onChange={onTab} className="shrink-0 px-2" />
      <div className="if-scroll min-h-0 flex-1 overflow-y-auto">
        <TabPanel idBase={idBase} id={active}>
          {active === "brief" && brief && (
            brief.loading ? <div className="px-4"><Loading label="Loading the brief…" /></div>
              : brief.error || !brief.data ? <div className="p-4"><Notice tone="fail" role="alert" title="The brief could not be loaded">{brief.error}</Notice><Button className="mt-3" size="sm" onClick={brief.retry}>Try again</Button></div>
              : <ChallengeBriefPanel brief={brief.data} preflight={preflight} preflightError={preflightError} workspaceVersion={workspaceVersion} designId={designId} />
          )}
          {active === "inspect" && <Inspector resource={selected} />}
          {active === "checks" && <ChecksPanel />}
        </TabPanel>
      </div>
    </div>
  );
}
