import type { LearningModule } from "@infraforge/contracts/learning";
import { openTheForwardingGate } from "./lessons/open-the-forwarding-gate";
export const lbForwardingLessons = [openTheForwardingGate];
export const lbForwarding: LearningModule = {id: "lb-forwarding", title: "Forward work before it expires", availability: "available",
  summary: "Distinguish active admission from waiting space using saved load-balancer and caller outcomes.", lessonIds: lbForwardingLessons.map(l => l.id)};
