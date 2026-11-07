export { track } from "./track";
import { incidentEvidenceLessons } from "./incident-evidence";
import { firstFailureLessons } from "./first-failure";
export const lessons = [...firstFailureLessons, ...incidentEvidenceLessons];
