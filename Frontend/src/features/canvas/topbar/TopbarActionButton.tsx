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

  let variantStyles = "";
  if (variant === "deploy") {
    variantStyles = "bg-[#5B8CFF] text-[#081018] hover:bg-[#7AA2FF]";
  } else if (variant === "delete") {
    variantStyles = "bg-[rgba(240,86,74,0.08)] border border-[rgba(240,86,74,0.35)] text-[#F0564A] hover:bg-[rgba(240,86,74,0.16)]";
  } else {
    variantStyles = "bg-[#171C27] border border-[#273042] text-[#AAB4C5] hover:border-[#35415A] hover:text-[#EDF1F7]";
  }

  const cursorStyles = isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer";

  return (
    <button
      className={`h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors duration-150 ${cursorStyles} ${variantStyles}`}
      onClick={onclick}
      disabled={isDisabled}
    >
      <Icon size={14} strokeWidth={2} />
      {label}
    </button>
  );
}