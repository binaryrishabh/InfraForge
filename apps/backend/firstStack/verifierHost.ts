import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { executionSource } from "../internalModel2/identity";
import { imagePattern } from "./isolationPolicy";
import { readProtectedJson } from "./verifierQualification";
import { createVerifierLifecycle } from "./verifierLifecycle";
import { verifierDrainMs } from "./verifierDrain";

// Dedicated trusted host process. The ordinary API/worker never import this module.
const settings = z.object({ enabled: z.boolean().default(false), image: z.string().regex(imagePattern),
  endpoint: z.string().regex(/^unix:\/\/\/run\/user\/[1-9][0-9]*\/docker\.sock$/),
  qualification: z.literal("/etc/infraforge/verifier/qualification.json") }).strict()
  .parse(await readProtectedJson("/etc/infraforge/verifier/settings.json"));
if (!settings.enabled) throw Error("First-stack admission disabled");
const credentialDirectory = process.env.CREDENTIALS_DIRECTORY;
if (!credentialDirectory) throw Error("Verifier requires systemd database credential");
const databaseUrl = (await readFile(join(credentialDirectory, "database-url"), "utf8")).trim();
const lifecycle = createVerifierLifecycle(settings, executionSource,
  { ...process.env, DATABASE_URL: databaseUrl, WORKER_DATABASE_MODE: "direct" });
const startupDeadline = setTimeout(() => process.exit(1), 30000);
const verifier = await lifecycle.start();
clearTimeout(startupDeadline);
const server = createServer(async (request, response) => {
  if (request.url === "/health/live") { response.writeHead(200); response.end("ok"); return; }
  if (request.url === "/health/operations") {
    // This dedicated server binds only loopback. Never proxy this operator route.
    try {
      const operations = await verifier.operations();
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(operations));
    } catch {
      response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ queue: null, storage: null }));
    }
    return;
  }
  if (request.url !== "/health/ready") { response.writeHead(404); response.end(); return; }
  const available = verifier.availability();
  response.writeHead(available.available ? 200 : 503,
    { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify({ success: available.available }));
});
server.listen(3003, "127.0.0.1");
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true; server.close();
  // Process exit closes sessions; uncertain work remains reserved for startup recovery.
  const deadline = setTimeout(() => process.exit(1), verifierDrainMs + 5000);
  try { await verifier.close(); clearTimeout(deadline); process.exit(0); }
  catch { process.exit(1); }
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
