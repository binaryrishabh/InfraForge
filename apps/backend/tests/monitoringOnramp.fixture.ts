import { selectLearningSuggestions } from "@infraforge/contracts/learning";
import { LEARNING_REGISTRY } from "../learning/registry";

const tracks = LEARNING_REGISTRY.listTracks();
const lessons = LEARNING_REGISTRY.listLessons();
console.log(JSON.stringify({
  catalog: { tracks, lessons, progress: [], suggestions: selectLearningSuggestions(tracks, lessons, []) },
  details: LEARNING_REGISTRY.listLessons({trackId: "observability", moduleId: "monitoring-ownership"}).map(lesson => ({lesson, progress: null, challenge: null})),
}));
