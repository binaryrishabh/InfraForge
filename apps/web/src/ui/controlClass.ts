import { cx } from "./cx";

export const controlClass = cx("w-full rounded-md border border-line-strong bg-raised px-3 text-sm text-ink",
  "placeholder:text-ink-3 transition-colors duration-150 hover:border-ink-3",
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:border-accent disabled:opacity-50 aria-[invalid=true]:border-fail");
