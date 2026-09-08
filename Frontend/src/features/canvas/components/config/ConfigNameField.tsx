interface ConfigNameFieldProps {
  name: string | undefined;
  fallbackId: string;
  onRename: (name: string | undefined) => void;
}

/* Live node-name editor. Fully controlled by the store: every keystroke
   commits straight to the resource, so the canvas card renames instantly
   and a LIVE deployment picks it up through the sync-topology debounce. */
export function ConfigNameField({ name, fallbackId, onRename }: ConfigNameFieldProps) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-[#677185] font-semibold mb-1.5">
        Node name
      </label>
      <input
        type="text"
        value={name ?? ""}
        placeholder={fallbackId}
        onChange={(e) =>
          onRename(e.target.value.trim() === "" ? undefined : e.target.value)
        }
        className="w-full h-9 rounded-lg bg-[#0B0E14] border border-[#273042] text-[13px] text-[#EDF1F7] placeholder-[#677185] px-3 outline-none focus:border-[#5B8CFF] focus:shadow-[0_0_0_3px_rgba(91,140,255,0.18)] transition-colors duration-150"
      />
      <p className="text-[11px] text-[#677185] mt-1.5 leading-relaxed">
        Renames the node on the canvas instantly. Empty falls back to the node id.
      </p>
    </div>
  );
}