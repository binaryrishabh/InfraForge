import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { Button } from "@/ui/Button";

const key = (id: string, version: number) => `infraforge:hints:${id}:v${version}`;
function readCount(id: string, version: number) { try { return Number(localStorage.getItem(key(id, version))) || 0; } catch { return 0; } }

/* Progressive hints, one at a time, from nudge to near-answer. How many are open
is remembered in this browser only; it never affects evaluation. */
export function HintReveal({ challengeId, version, hints }: { challengeId: string; version: number; hints: string[] }) {
  const [shown, setShown] = useState(() => Math.min(readCount(challengeId, version), hints.length));
  const reveal = () => {
    const next = Math.min(shown + 1, hints.length);
    setShown(next);
    try { localStorage.setItem(key(challengeId, version), String(next)); } catch { /* storage unavailable */ }
  };
  return (
    <div>
      <ol className="flex flex-col gap-2" aria-live="polite">
        {hints.slice(0, shown).map((hint, index) => (
          <li key={index} className="rounded-md border border-marker bg-marker-soft px-3 py-2 text-sm text-ink">
            <span className="if-eyebrow mb-0.5 block !text-ink-2">Hint {index + 1} of {hints.length}</span>{hint}
          </li>
        ))}
      </ol>
      {shown < hints.length ? (
        <Button size="sm" variant="secondary" className={shown ? "mt-2" : ""} icon={<Lightbulb size={14} aria-hidden="true" />} onClick={reveal}>
          {shown === 0 ? `Show a hint (1 of ${hints.length})` : `Show hint ${shown + 1} of ${hints.length}`}
        </Button>
      ) : <p className="mt-2 text-xs text-ink-3">All hints are open. The full explanation unlocks after your first judged attempt.</p>}
    </div>
  );
}
