import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/features/auth/store/auth.store";

/* Shell quick-nav as SEPARATE buttons, not one grouped pill.
   "floating" (design page): navbar-height (h-12) blurred surfaces riding
   beside the floating navbar. "inline" (live topbar): compact h-8 controls
   that nest inside the bar without colliding with its borders. */

const FLOATING_SURFACE =
  "border border-[#273042] bg-[#12161F]/95 backdrop-blur-md shadow-[0_8px_24px_rgba(0,0,0,0.45)]";
const INLINE_SURFACE = "border border-[#273042] bg-[#171C27]";

interface QuickNavButtonProps {
  title: string;
  icon: LucideIcon;
  onClick?: () => void;
  soon?: boolean;
  surfaceClass: string;
  sizeClass: string;
  radiusClass: string;
}

function QuickNavButton({
  title,
  icon: Icon,
  onClick,
  soon = false,
  surfaceClass,
  sizeClass,
  radiusClass,
}: QuickNavButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`${sizeClass} ${radiusClass} ${surfaceClass} flex items-center justify-center relative transition-colors duration-150 text-[#677185] hover:text-[#AAB4C5] hover:border-[#35415A] hover:bg-[#171C27] cursor-pointer`}
    >
      <Icon size={16} strokeWidth={1.75} />
      {soon && (
        <span className="absolute -top-1 -right-1 text-[7px] bg-[#273042] text-[#AAB4C5] px-0.5 rounded uppercase tracking-wide">
          soon
        </span>
      )}
    </button>
  );
}

interface QuickNavClusterProps {
  variant?: "floating" | "inline";
}

export function QuickNavCluster({ variant = "floating" }: QuickNavClusterProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();

  const floating = variant === "floating";
  const surfaceClass = floating ? FLOATING_SURFACE : INLINE_SURFACE;
  const sizeClass = floating ? "h-12 w-12" : "h-8 w-8";
  const radiusClass = floating ? "rounded-xl" : "rounded-lg";
  const gapClass = floating ? "gap-2" : "gap-1.5";

  const handleSignOut = async () => {
    await signOut();
    navigate("/signin");
  };

  return (
    <div className={`flex items-center ${gapClass}`}>
      <QuickNavButton
        title="Dashboard"
        icon={LayoutDashboard}
        onClick={() => navigate("/dashboard")}
        surfaceClass={surfaceClass}
        sizeClass={sizeClass}
        radiusClass={radiusClass}
      />
      <QuickNavButton
        title="Reports"
        icon={FileText}
        onClick={() => navigate("/reports")}
        soon
        surfaceClass={surfaceClass}
        sizeClass={sizeClass}
        radiusClass={radiusClass}
      />
      <QuickNavButton
        title="Settings"
        icon={Settings}
        onClick={() => navigate("/settings")}
        soon
        surfaceClass={surfaceClass}
        sizeClass={sizeClass}
        radiusClass={radiusClass}
      />
      {user && (
        <button
          type="button"
          onClick={handleSignOut}
          title={`Sign out ${user.name}`}
          className={`${sizeClass} rounded-full ${surfaceClass} flex items-center justify-center text-[#5B8CFF] font-semibold ${
            floating ? "text-sm" : "text-xs"
          } hover:bg-[#232B3B] hover:border-[#35415A] transition-colors duration-150 relative group cursor-pointer`}
        >
          {user.name.charAt(0).toUpperCase()}
          <span className="absolute top-full right-0 mt-1 bg-[#171C27] border border-[#273042] px-2 py-1 rounded text-[11px] text-[#EDF1F7] whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 flex items-center gap-1.5">
            <LogOut size={12} /> Sign out
          </span>
        </button>
      )}
    </div>
  );
}