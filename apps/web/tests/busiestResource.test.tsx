import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { predictionChoices } from "../src/features/challenges/predictionChoices";
import { PredictionQuestionField } from "../src/features/challenges/components/AttemptDialog";

const question = {id: "where", kind: "busiest-resource", prompt: "Which resource will have the highest CPU?"} as const;
test("the generic prediction renderer offers the design's resource ids for busiest-resource", () => {
  expect(predictionChoices(question, ["Virtual Machine"], ["app", "db"])).toEqual([{value: "app", label: "app"}, {value: "db", label: "db"}]);
  expect(predictionChoices(question, ["Virtual Machine"])).toEqual([]);
  const html = renderToStaticMarkup(<PredictionQuestionField question={question} index={0} value="db" onChange={() => {}} designTypes={["Virtual Machine"]} designIds={["app", "db"]} />);
  expect(html).toContain('value="app"'); expect(html).toContain('value="db"'); expect(html).toContain("Which resource will have the highest CPU?");
});
