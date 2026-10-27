import { Check, Circle } from "lucide-react";
import { passwordChecks } from "@infraforge/contracts/auth";

const LABELS = {
  length: "At least 8 characters",
  lower: "A lowercase letter",
  upper: "An uppercase letter",
  digit: "A number",
  symbol: "A symbol, like ! ? # or @",
} as const;

/* Live rules under the password field. Each line turns green as it is met. */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  return (
    <ul id={id} className="mt-2 grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {passwordChecks(password).map(({ id: rule, ok }) => (
        <li key={rule} className={ok ? "flex items-center gap-1.5 text-ok" : "flex items-center gap-1.5 text-ink-3"}>
          {ok ? <Check size={13} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
          <span>{LABELS[rule]}<span className="sr-only">{ok ? " — done" : " — not yet"}</span></span>
        </li>
      ))}
    </ul>
  );
}
