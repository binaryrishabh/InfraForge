import { openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { AppError } from "../../utils/errors";
import { canonical, hash } from "../canonical";
import { privateBundleSchema, type ChallengeDefinition } from "./schema";

export class ScoringUnavailableError extends AppError {
  constructor() { super("Scoring unavailable", 503); }
}
export const scoringUnavailable = () => ({ schema: "infraforge-scoring-unavailable/1" as const,
  state: "unavailable" as const, message: "Scoring unavailable" as const });

// No fallback path or source-repository lookup. Only the server configures this.
export function configuredScoringDirectory(configured = process.env.INFRAFORGE_SCORING_DIRECTORY) {
  if (!configured || !isAbsolute(configured)) throw new ScoringUnavailableError();
  try {
    const directory = realpathSync(configured), repository = realpathSync(resolve(import.meta.dir, "../../../.."));
    const child = relative(repository, directory);
    if (!child || (!child.startsWith(`..${sep}`) && !isAbsolute(child))) throw new ScoringUnavailableError();
    return directory;
  } catch { throw new ScoringUnavailableError(); }
}

// Open once, bound bytes before parsing, and discard every underlying error.
// Paths, filesystem diagnostics, schema errors and hidden content never escape.
export function readPrivateBundle(definition: ChallengeDefinition, directory: string | undefined) {
  let fd: number | undefined;
  try {
    if (!directory || !/^[a-z0-9-]+$/.test(definition.id) || !/^[a-zA-Z0-9-]+$/.test(definition.version)) throw Error();
    const filename = `${definition.id}.v${definition.version}.json`, path = resolve(directory, filename);
    if (relative(realpathSync(directory), realpathSync(path)) !== filename) throw Error();
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw Error();
    const bytes = Buffer.alloc(stat.size + 1), length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length !== stat.size) throw Error();
    const raw: unknown = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    if (hash(raw) !== definition.scoring.sha256) throw Error();
    const bundle = privateBundleSchema.parse(raw);
    if (canonical(raw) !== canonical(bundle) || bundle.id !== definition.id || bundle.challengeVersion !== definition.version ||
      bundle.version !== definition.scoring.version) throw Error();
    return bundle;
  } catch { throw new ScoringUnavailableError(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
