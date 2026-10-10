import { readFile } from "node:fs/promises";
import { connectDatabase, databaseUrl, CutoverError, safeFailure } from "./database";
import { collectEvidence, compareRestored, type Evidence } from "./evidence";
import { checkEightMigrationBaseline, initializeReference } from "./baseline";
import { retirementRequest, retireLegacyRuns } from "./retire";

const [action, ...args] = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
let db: ReturnType<typeof connectDatabase> | undefined;
let reference: ReturnType<typeof connectDatabase> | undefined;
try {
  if (action === "compare") {
    if (args.length !== 2) throw new CutoverError("compare requires source and restored evidence files");
    const files = await Promise.all(args.map(async (path) => JSON.parse(await readFile(path, "utf8")) as Evidence));
    const result = compareRestored(files[0]!, files[1]!);
    console.log(JSON.stringify(result));
    if (result.result !== "PASS") process.exitCode = 1;
  } else {
    if (!["evidence", "baseline", "reference", "retire"].includes(action ?? "")) throw new CutoverError("Use evidence, baseline, reference, retire or compare");
    const permitted = new Set(["--ids-file", "--fence-ack", "--evidence", "--apply"]);
    for (let i = 0; i < args.length; i++) {
      const key = args[i]!;
      if (action !== "retire" || !permitted.delete(key)) throw new CutoverError("Unknown or duplicate operator option");
      if (key !== "--apply" && (!args[++i] || args[i]!.startsWith("--"))) throw new CutoverError("Missing operator option value");
    }
    const value = action === "reference" ? process.env.CUTOVER_REFERENCE_URL : process.env.CUTOVER_DATABASE_URL;
    const url = databaseUrl(value, action !== "evidence");
    if (action === "reference" && (!["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || !/^\/infraforge_reference_[a-f0-9]{8,64}$/.test(url.pathname))) {
      throw new CutoverError("Reference initialization requires an explicit local disposable reference URL");
    }
    db = connectDatabase(url.href, "infraforge-cutover-" + action);
    await db.connect();
    if (action === "evidence") console.log(JSON.stringify(await collectEvidence(db)));
    else if (action === "reference") {
      await initializeReference(db, url.pathname.slice(1));
      console.log(JSON.stringify({ result: "PASS", referenceInitialized: true, migrations: 8 }));
    } else if (action === "baseline") {
      const other = databaseUrl(process.env.CUTOVER_REFERENCE_URL, true);
      if (!["localhost", "127.0.0.1", "postgres"].includes(other.hostname) || !/^\/infraforge_reference_[a-f0-9]{8,64}$/.test(other.pathname)) {
        throw new CutoverError("Baseline proof requires a separate local disposable reference");
      }
      if (other.hostname === url.hostname && other.port === url.port && other.pathname === url.pathname) throw new CutoverError("Reference must differ from target");
      reference = connectDatabase(other.href, "infraforge-cutover-reference");
      await reference.connect();
      const result = await checkEightMigrationBaseline(db, reference);
      console.log(JSON.stringify(result));
      if (result.result !== "PASS") process.exitCode = 1;
    } else {
      const idsFile = option("--ids-file");
      if (!idsFile) throw new CutoverError("retire requires --ids-file");
      const request = retirementRequest(JSON.parse(await readFile(idsFile, "utf8")), option("--fence-ack"), option("--evidence"));
      if (!args.includes("--apply")) {
        const evidence = await collectEvidence(db);
        const selected = evidence.activeDeployments.filter((row) => request.ids.includes(row.id));
        if (selected.length !== request.ids.length || selected.some((row) => row.status !== "live") || evidence.activeDeployments.length !== request.ids.length) {
          throw new CutoverError("Dry-run active deployment set/status mismatch");
        }
        console.log(JSON.stringify({ result: "DRY_RUN", ids: request.ids, count: request.ids.length, requiresStoppedAndFencedWriters: true }));
      } else console.log(JSON.stringify(await retireLegacyRuns(db, request)));
    }
  }
} catch (error) { console.error(JSON.stringify({ result: "FAIL", action, error: safeFailure(error) })); process.exitCode = 1; }
finally { await Promise.allSettled([db?.end(), reference?.end()]); }
