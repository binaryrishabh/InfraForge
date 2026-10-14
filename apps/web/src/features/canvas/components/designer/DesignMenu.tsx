import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FilePlus2, FolderOpen, PencilLine, Copy, RotateCcw, Trash2, Check, Save } from "lucide-react";
import { toast } from "sonner";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import { getAllInfrastructure } from "@/api/infrastructure.api";
import { openChallengeWorkspace } from "@/api/challenges.api";
import { Menu, type MenuItem } from "@/ui/Menu";
import { useCanvasStore } from "../../store/canvasStore";
import { requestNewDesign, saveDesign } from "../../designActions";
import { errorMessage } from "@/api/errorMessage";

/* The design's identity doubles as its menu: open another saved design,
rename, copy, start over, delete. Opening goes through the route so unsaved
work is always confirmed first. */
export function DesignMenu() {
  const navigate = useNavigate();
  const id = useCanvasStore((s) => s.currentLayoutId);
  const name = useCanvasStore((s) => s.currentLayoutName);
  const challenge = useCanvasStore((s) => s.currentChallengeId);
  const busy = useCanvasStore((s) => s.isDeploying);
  const [designs, setDesigns] = useState<Infrastructure[]>([]);
  useEffect(() => { getAllInfrastructure().then(setDesigns).catch(() => setDesigns([])); }, [id]);
  const modal = (type: "rename" | "save" | "delete") => useCanvasStore.getState().setModalState({ type });
  const restart = async () => {
    if (!challenge) return;
    try { navigate(`/design?design=${(await openChallengeWorkspace(challenge, { fresh: true })).designId}`); }
    catch { toast.error("A fresh copy of the starter could not be created."); }
  };
  const recent = designs.filter((d) => d.id !== id).slice(0, 6);
  const save = () => saveDesign().then((done) => { if (done) toast.success("Design saved"); }).catch((e) => toast.error(errorMessage(e, "The design could not be saved.")));
  const items: Array<MenuItem | "separator"> = [
    { id: "save", label: id ? "Save" : "Save design…", icon: <Save size={15} />, onSelect: () => void save(), disabled: busy, hint: "Ctrl+S" },
    { id: "new", label: "New design", icon: <FilePlus2 size={15} />, onSelect: requestNewDesign, disabled: busy },
    ...recent.map((d): MenuItem => ({ id: `open-${d.id}`, label: d.name, icon: <FolderOpen size={15} />, hint: d.challengeId ? "challenge" : undefined,
      onSelect: () => navigate(`/design?design=${d.id}`) })),
    { id: "all", label: "All designs…", icon: <FolderOpen size={15} />, onSelect: () => navigate("/designs") },
    "separator",
    ...(id ? [{ id: "rename", label: "Rename…", icon: <PencilLine size={15} />, onSelect: () => modal("rename"), disabled: busy }] : []),
    ...(!challenge ? [{ id: "copy", label: id ? "Save as a new design…" : "Save design…", icon: <Copy size={15} />, onSelect: () => modal("save"), disabled: busy }] : []),
    ...(challenge ? [{ id: "restart", label: "Start over from the starter", icon: <RotateCcw size={15} />, onSelect: () => void restart(), disabled: busy }] : []),
    ...(id ? ["separator" as const, { id: "delete", label: "Delete design…", icon: <Trash2 size={15} />, onSelect: () => modal("delete"), danger: true, disabled: busy }] : []),
  ];
  return (
    <Menu align="start" width="w-72" triggerLabel={`Design: ${name ?? "Untitled"}. Open design menu`} items={items}
      triggerClassName="group inline-flex h-10 max-w-[min(44vw,320px)] items-center gap-1.5 rounded-md px-2 text-left hover:bg-sunken"
      header={id ? <p className="flex items-center gap-1.5 px-2.5 pt-1.5 pb-2 text-xs text-ink-3"><Check size={12} aria-hidden="true" /> Editing {name}</p> : undefined}
      trigger={<>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold leading-tight text-ink">{name ?? "Untitled design"}</span>
          <SaveState />
        </span>
        <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-ink-3 group-hover:text-ink" />
      </>} />
  );
}

function SaveState() {
  const id = useCanvasStore((s) => s.currentLayoutId);
  const saved = useCanvasStore((s) => s.currentLayoutSaved);
  const empty = useCanvasStore((s) => s.resources.length === 0);
  const text = !id ? (empty ? "Not saved" : "Not saved yet") : saved ? "Saved" : "Unsaved changes";
  return (
    <span className="flex items-center gap-1 text-[11.5px] leading-tight text-ink-3">
      <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${id && saved ? "bg-ok" : !empty ? "bg-warn" : "bg-ink-3"}`} />{text}
    </span>
  );
}
