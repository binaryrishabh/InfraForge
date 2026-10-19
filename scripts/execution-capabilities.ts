import { readFileSync, writeFileSync } from "node:fs";
import { executionDescriptor } from "../apps/backend/executionIdentity/descriptor";
if (!process.argv.includes("--review-imports")) throw Error("Explicit --review-imports required after source/capability review");
const path = "apps/backend/executionIdentity/capabilityImportReviews.json";
const previous = JSON.parse(readFileSync(path, "utf8"));
executionDescriptor(undefined, undefined, modules => {
  writeFileSync(path, JSON.stringify({ ...previous, modules }, null, 2) + "\n");
  console.info(JSON.stringify({ reviewedImporters: Object.keys(modules).length }));
});
