import { educationalExample } from "../internal-model2/example";
import { LESSON_VERSION, phases, type ReadPhase } from ".";
export function restartLesson(phase: ReadPhase) {
  const draft = educationalExample();
  draft.origin = `InfraForge ${LESSON_VERSION}; explicit authored teaching scenario, no physical or provider measurement`;
  draft.values.rate = "1500";
  draft.commands[1]!.at = String(phases[phase].atUs);
  return draft;
}
