import { checkFrontend, exactOrigin, fullSha, publicJSON, verifyBackend } from "./public-check";
const [sha = "", frontend = "", backend = "", stagedFile] = process.argv.slice(2);
fullSha(sha);
exactOrigin(frontend);
// Protected staged deployments are read with authenticated `vercel curl`, never by disabling protection.
const web = stagedFile ? await Bun.file(stagedFile).json() : (await publicJSON(`${frontend}/release.json`)).body;
checkFrontend(sha, backend, web);
await verifyBackend(sha, backend);
console.log(`Frontend/backend ${sha} matched. This gate proves identity/endpoints, not authenticated OAuth/WS journeys.`);
