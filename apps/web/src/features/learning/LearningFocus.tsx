import { useEffect, useRef, type ReactNode } from "react";
import { focusLearningHeading } from "./navigationFocus";

/** Move focus once per destination/request state, never on filters or local answers.
 * The heading stays outside the Tab order; native controls retain normal keyboard behavior. */
export function LearningFocus({ destination, children }: { destination: string; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusLearningHeading(container.current);
  }, [destination]);
  return <div ref={container}>{children}</div>;
}
