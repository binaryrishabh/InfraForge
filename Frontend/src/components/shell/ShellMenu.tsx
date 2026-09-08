import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Menu,
  LayoutDashboard,
  FileText,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/features/auth/store/auth.store";

/* Hamburger shell menu for the fullscreen designer. One button at the
   top-right; everything (profile, dashboard, reports, settings, sign out)
   lives inside the dropdown. "floating" rides beside the floating navbar at
   navbar height; "inline" nests inside the live topbar at control height. */

const FLOATING_SURFACE =
  "border border-[#273042] bg-[#12161F]/95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.45)]";
const INLINE_SURFACE = "border border-[#273042] bg-[#171C27]";

interface ShellMenuItemProps {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
  soon?: boolean;
  danger?: boolean;
}

function ShellMenuItem({ title, icon: Icon, onClick, soon = false, danger = false }: ShellMenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-[12px] transition-colors duration-150 cursor-pointer ${
        danger
          ? "text-[#F0564A] hover:bg-[rgba(240,86,74,0.10)]"
          : "text-[#AAB4C5] hover:bg-[#171C27] hover:text-[#EDF1F7]"
      }`}
    >
      <Icon size={15} strokeWidth={1.75} />
      <span className="flex-1 text-left">{title}</span>
      {soon && (
        <span className="text-[7px] bg-[#273042] text-[#AAB4C5] px-1 py-0.5 rounded uppercase tracking-wide">
          soon
        </span>
      )}
    </button>
  );
}

interface ShellMenuProps {
  variant?: "floating" | "inline";
}

export function ShellMenu({ variant = "floating" }: ShellMenuProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate("/signin");
  };

  const goTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const floating = variant === "floating";
  const surfaceClass = floating ? FLOATING_SURFACE : INLINE_SURFACE;
  const sizeClass = floating ? "h-12 w-12 rounded-xl" : "h-8 w-8 rounded-lg";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Menu"
        onClick={() => setOpen(!open)}
        className={`${sizeClass} ${surfaceClass} flex items-center justify-center transition-colors duration-150 ${
          open
            ? "text-[#EDF1F7] border-[#35415A]"
            : "text-[#AAB4C5] hover:text-[#EDF1F7] hover:border-[#35415A]"
        } cursor-pointer`}
      >
        <Menu size={16} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 rounded-xl border border-[#273042] bg-[#12161F] backdrop-blur-md shadow-[0_16px_40px_rgba(0,0,0,0.5)] p-1.5 z-50">
          {user && (
            <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 rounded-lg bg-[#171C27] border border-[#1F2633]">
              <span className="w-8 h-8 rounded-full bg-[#232B3B] border border-[#273042] flex items-center justify-center text-[#5B8CFF] font-semibold text-sm shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] text-[#EDF1F7] font-medium truncate">
                  {user.name}
                </span>
                <span className="block text-[10px] text-[#677185] truncate">
                  {user.email}
                </span>
              </span>
            </div>
          )}
          <ShellMenuItem
            title="Dashboard"
            icon={LayoutDashboard}
            onClick={() => goTo("/dashboard")}
          />
          <ShellMenuItem
            title="Reports"
            icon={FileText}
            onClick={() => goTo("/reports")}
            soon
          />
          <ShellMenuItem
            title="Settings"
            icon={Settings}
            onClick={() => goTo("/settings")}
            soon
          />
          <div className="h-px bg-[#1F2633] my-1" />
          <ShellMenuItem title="Sign out" icon={LogOut} onClick={handleSignOut} danger />
        </div>
      )}
    </div>
  );
}