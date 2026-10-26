import { useEffect, useRef, useState } from "react";
import { mountTurnstile } from "../turnstileWidget";
import type { TurnstileAction } from "../turnstileToken";

export function TurnstileWidget({ siteKey, action }: { siteKey: string | null; action: TurnstileAction }) {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("Complete the security check.");
  useEffect(() => {
    if (container.current) return mountTurnstile(container.current, siteKey, action, setMessage);
  }, [siteKey, action]);
  if (!siteKey) return null;
  return <div><div ref={container} /><p role="status" className="mt-2 text-xs text-ink-3">{message}</p></div>;
}
