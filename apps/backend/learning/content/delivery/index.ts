export { track } from "./track";
import { lessons as first } from "./first-cdn";
import { originLoadLessons } from "./origin-load";
export const lessons = [...first, ...originLoadLessons];
