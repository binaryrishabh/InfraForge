import { checkHistoricalSlice } from "./historical-slice-reviews";

// The original scope checker is retained in the authenticated slice archive.
// This command verifies its historical receipt and cannot grant current capabilities.
console.info(JSON.stringify(checkHistoricalSlice("docs/reality/first-stack-report-source-review.json")));
