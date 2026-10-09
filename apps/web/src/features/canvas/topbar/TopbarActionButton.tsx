import { FilePlus, Save, RefreshCw, Rocket, Trash2, Circle } from "lucide-react";

interface TopbarActionButtonProps {
  label: string;
  onclick?: () => void;
  variant?: "new" | "save" | "update" | "deploy" | "delete" | "default";
}

const ICON_MAP = {
  new: FilePlus,
  save: Save,
  update: RefreshCw,
  deploy: Rocket,
  delete: Trash2,
  default: Circle,
};

export function TopbarActionButton({ label, onclick, variant = "default" }: TopbarActionButtonProps) {
  const isDisabled = !onclick;
  const Icon = ICON_MAP[variant];
  let variantStyles: string;
  if (variant === "deploy") {
    // The single most important action owns the warm amber — nobody else.
    variantStyles = "bg-[#E8A33D] text-[#14161A] hover:bg-[#F0B45C]";
  } else if (variant === "delete") {
    // Brick red lives only on destructive actions, as a quiet ghost.
    variantStyles = "bg-transparent border border-[#C4574A]/40 text-[#C4574A] hover:bg-[#C4574A]/10";
  } else {
    variantStyles = "bg-[#1C1F26] border border-[#2A2E37] text-[#8B909C] hover:border-[#3A3F4A] hover:text-[#EDEEF0]";
  }
  const cursorStyles = isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer";
  return (
    <button
      className={`h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 transition-colors duration-150 ${cursorStyles} ${variantStyles}`}
      onClick={onclick}
      disabled={isDisabled}
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  );
}
