import type { ReactNode } from "react";
import { useLearningFocus } from "./hooks";

/** Move focus once per destination/request state, never on filters or local answers.
 * The heading stays outside the Tab order; native controls retain normal keyboard behavior. */
export function LearningFocus({ destination, children }: { destination: string; children: ReactNode }) {
  const container = useLearningFocus(destination);
  return <div ref={container}>{children}</div>;
}
