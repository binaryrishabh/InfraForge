import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Infrastructure } from "@infraforge/contracts/infrastructure";
import { deleteInfrastructure, getAllInfrastructure, updateInfrastructure } from "@/api/infrastructure.api";
import { errorMessage } from "@/api/errorMessage";
import { useRequest } from "@/api/useRequest";
import { relativeTime, formatDate } from "@/lib/format";
import { Button } from "@/ui/Button";
import { EmptyState, Loading, Notice, Page, PageHeader } from "@/ui/Page";
import { Menu } from "@/ui/Menu";
import { Tag } from "@/ui/Tag";
import { NameDialog, TypeToConfirmDialog } from "@/ui/ConfirmDialogs";
import { useCanvasStore } from "@/features/canvas/store/canvasStore";
import { requestNewDesign } from "@/features/canvas/designActions";
import { MiniMap } from "@/features/timetable/MiniMap";

type Pending = { kind: "rename" | "delete"; design: Infrastructure } | null;

/* Saved designs: freeform designs and challenge workspaces. Opening goes
through the designer's route, which protects unsaved canvas work. */
export function DesignsPage() {
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const load = useCallback(() => getAllInfrastructure(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error, retry } = useRequest(load, "Your designs could not be loaded.");
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setVersion((v) => v + 1);
  const act = async (work: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try { await work(); toast.success(done); setPending(null); refresh(); }
    catch (err) { toast.error(errorMessage(err, failed)); }
    finally { setBusy(false); }
  };
  const remove = (design: Infrastructure) => act(async () => {
    await deleteInfrastructure(design.id);
    const store = useCanvasStore.getState();
    // The canvas keeps its content but no longer points at the deleted record.
    if (store.currentLayoutId === design.id) { store.setCurrentLayoutId(null); store.setCurrentChallengeId(null); store.setCurrentLayoutSaved(false); }
  }, "Design deleted", "The design could not be deleted. Stop any active run that uses it first.");
  const rename = (design: Infrastructure, name: string) => act(async () => {
    await updateInfrastructure(design.id, { name });
    if (useCanvasStore.getState().currentLayoutId === design.id) useCanvasStore.getState().setCurrentLayoutName(name);
  }, "Design renamed", "The design could not be renamed.");
  return (
    <Page>
      <PageHeader eyebrow="Designs" title="Your saved designs." lede="Freeform designs and challenge workspaces. Runs keep their own copy of the design they started from, so editing or deleting a design never changes a recorded run."
        actions={<Button variant="primary" icon={<FilePlus2 size={15} aria-hidden="true" />} onClick={() => { navigate("/design"); requestNewDesign(); }}>New design</Button>} />
      {loading ? <Loading label="Loading designs…" /> : error || !data ? (
        <div className="mt-8"><Notice tone="fail" role="alert">{error}</Notice><Button className="mt-3" size="sm" onClick={retry}>Try again</Button></div>
      ) : data.length === 0 ? (
        <div className="mt-8"><EmptyState title="No saved designs yet." action={<Button size="sm" onClick={() => navigate("/design")}>Open the designer</Button>}>
          Designs you save, and the workspaces of challenges you open, appear here.</EmptyState></div>
      ) : (
        <ul className="mt-2">
          {data.map((design) => {
            const count = design.layout?.resources?.length ?? 0;
            const links = design.layout?.connectionLines?.length ?? 0;
            return (
              <li key={design.id} className="flex items-center gap-4 border-b border-line py-[var(--if-list-y)]">
                <span className="flex h-14 w-[120px] shrink-0 items-center justify-center border border-line bg-canvas text-ink-2 max-sm:hidden">
                  <MiniMap className="max-h-12 max-w-[108px]" nodes={(design.layout?.resources ?? []).map((r) => ({ id: r.id, type: r.type, label: r.name || r.id }))}
                    edges={(design.layout?.connectionLines ?? []).map((c) => ({ source: c.sourceId, target: c.targetId }))} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link to={`/design?design=${design.id}`} className="truncate text-[16px] font-semibold text-ink underline-offset-4 hover:underline">{design.name}</Link>
                    {design.challengeId && <Tag tone="neutral">Challenge workspace{design.challengeVersion ? ` · v${design.challengeVersion}` : ""}</Tag>}
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-3">{count} {count === 1 ? "resource" : "resources"} · {links} {links === 1 ? "connection" : "connections"} · updated <time dateTime={design.updatedAt} title={formatDate(design.updatedAt)}>{relativeTime(design.updatedAt)}</time></p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => navigate(`/design?design=${design.id}`)} className="max-sm:hidden">Open</Button>
                <Menu triggerLabel={`More actions for ${design.name}`} triggerClassName="inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-sunken"
                  trigger={<MoreHorizontal size={16} aria-hidden="true" />} width="w-48" items={[
                    { id: "open", label: "Open", onSelect: () => navigate(`/design?design=${design.id}`) },
                    { id: "rename", label: "Rename…", icon: <PencilLine size={15} />, onSelect: () => setPending({ kind: "rename", design }) },
                    "separator",
                    { id: "delete", label: "Delete…", icon: <Trash2 size={15} />, danger: true, onSelect: () => setPending({ kind: "delete", design }) },
                  ]} />
              </li>
            );
          })}
        </ul>
      )}
      <NameDialog open={pending?.kind === "rename"} onOpenChange={(open) => { if (!open) setPending(null); }} title="Rename design" initialValue={pending?.design.name ?? ""}
        submitLabel="Rename" loading={busy} onSubmit={(name) => { if (pending) void rename(pending.design, name); }} />
      <TypeToConfirmDialog open={pending?.kind === "delete"} onOpenChange={(open) => { if (!open) setPending(null); }} name={pending?.design.name ?? ""} loading={busy}
        onConfirm={() => { if (pending) void remove(pending.design); }} />
    </Page>
  );
}
