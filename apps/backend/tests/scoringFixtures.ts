import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createChallengeRegistry, challengeDefinition } from "../firstStack/scoredChallenges/definition";
import { hash } from "../firstStack/canonical";

export const scenarioIds = ["lose-an-app-server", "url-redirect", "catalogue-api", "reviews-api", "small-paste-api", "preloaded-news-api", "price-history-api"];
export const fixtureDirectory = resolve(import.meta.dir, "fixtures/scoring");
// Only fake, burned teaching data. Never copies production private bundles.
export const fakeDefinitions = scenarioIds.map(id => {
  const definition = challengeDefinition(id, "2");
  const bundle = JSON.parse(readFileSync(resolve(fixtureDirectory, `${id}.v2.json`), "utf8"));
  definition.scoring = { version: bundle.version, sha256: hash(bundle) };
  return definition;
});
export const fixtureChallenges = createChallengeRegistry(fakeDefinitions, () => fixtureDirectory);
export function fixtureDefinition(id: string) {
  const definition = fixtureChallenges.definition(id, "2");
  return fixtureChallenges.scoring({ id, version: "2", definitionHash: hash(definition) });
}
