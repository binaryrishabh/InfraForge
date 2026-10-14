import { useNavigate } from "react-router-dom";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/features/auth/store/auth.store";
import { Menu } from "@/ui/Menu";

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  if (!user) return null;
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  const leave = async () => {
    try { await signOut(); navigate("/signin"); }
    catch { toast.error("Sign-out could not be confirmed. Try again."); }
  };
  return (
    <Menu triggerLabel={`Account: ${user.username ?? user.name}`} width="w-64"
      triggerClassName={compact ? "inline-flex size-8 items-center justify-center rounded-full border border-line-strong bg-surface text-[13px] font-semibold text-ink hover:border-ink-3"
        : "inline-flex h-9 items-center gap-2 rounded-md border border-transparent px-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink"}
      trigger={<>
        <span aria-hidden="true" className={compact ? "" : "inline-flex size-7 items-center justify-center rounded-full border border-line-strong bg-surface text-[13px] font-semibold text-ink"}>{initial}</span>
        {!compact && <span className="hidden max-w-[14ch] truncate lg:inline">{user.username ?? user.name}</span>}
      </>}
      header={<div className="mb-1 border-b border-line px-2.5 pt-1.5 pb-2.5">
        <p className="truncate text-sm font-semibold text-ink">{user.username ?? user.name}</p>
        <p className="truncate text-xs text-ink-3">{user.email}</p>
      </div>}
      items={[
        { id: "settings", label: "Settings", icon: <Settings size={15} />, onSelect: () => navigate("/settings") },
        "separator",
        { id: "signout", label: "Sign out", icon: <LogOut size={15} />, onSelect: () => void leave(), danger: true },
      ]} />
  );
}
