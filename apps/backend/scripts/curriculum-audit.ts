/* Read-only curriculum completeness audit, computed from the live registries (never from report prose).
   bun --no-env-file apps/backend/scripts/curriculum-audit.ts [--base <git ref of the released tree, default 46f8a9f>]
   Prints PASS or FAIL per check with exact numbers, then the final counts. Exit code 1 when any check fails.
   The invariants of tests/learningRegistryIntegrity.test.ts and tests/learningIntegrity.test.ts are restated here because
   those files register tests on import; run them with `bun test` for the full editorial checks (copied openings, titles, entry reviews). */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LearningLesson } from "@infraforge/contracts/learning";
import { learningContent as content } from "../learning/content";
import { LEARNING_REGISTRY } from "../learning/registry";
import { REVIEWED_CHALLENGES } from "../learning/reviewedChallenges";
import { CHALLENGE_VERSIONS } from "../challenges/definitions";
import { REGISTRY, categoryOf, latestChallenge, specHash } from "../challenges/registry";

const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1]! : "46f8a9f";
const backend = resolve(import.meta.dir, "..");
const dupes = (list: string[]) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];
const short = (list: string[], n = 8) => list.slice(0, n).join(", ") + (list.length > n ? `, +${list.length - n} more` : "");
const rank: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const labOf = (l: LearningLesson) => l.kind === "executable-lab" ? l.experiment.challengeId : null;

let failures = 0;
function check(name: string, errors: string[], numbers: string) {
  const ok = errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} (${numbers})`);
  for (const e of errors.slice(0, 20)) console.log(`        - ${e}`);
  if (errors.length > 20) console.log(`        - ... ${errors.length - 20} more`);
}

const current = content.lessons, archived = content.archivedLessons ?? [], all = [...current, ...archived];
const byId = new Map(current.map((l) => [l.id, l]));
const labs = current.filter((l) => l.kind === "executable-lab");
const listed = content.tracks.flatMap((t) => t.modules.flatMap((m) => m.lessonIds));

// ---- identity and registration
check("lesson ids unique (current)", dupes(current.map((l) => l.id)), `${current.length} current lessons`);
check("lesson id+version unique across current and archived", dupes(all.map((l) => `${l.id}@${l.contentVersion}`)), `${all.length} lesson versions`);
check("track ids unique", dupes(content.tracks.map((t) => t.id)), `${content.tracks.length} tracks`);
{
  const errors: string[] = []; let modules = 0;
  for (const t of content.tracks) { modules += t.modules.length; for (const d of dupes(t.modules.map((m) => m.id))) errors.push(`${t.id}: duplicate module ${d}`); }
  check("module ids unique within each track", errors, `${modules} modules`);
}
check("challenge id+version unique", dupes(CHALLENGE_VERSIONS.map((d) => `${d.id}@${d.version}`)), `${CHALLENGE_VERSIONS.length} versions`);
check("no duplicate registration: registry holds exactly the authored challenge versions", REGISTRY.all().length === CHALLENGE_VERSIONS.length ? [] : [`registry ${REGISTRY.all().length} vs authored ${CHALLENGE_VERSIONS.length}`], `${REGISTRY.all().length} registered, ${CHALLENGE_VERSIONS.length} authored`);
{
  const errors = [...dupes(listed).map((id) => `${id} is listed in more than one module (or twice)`),
    ...current.filter((l) => !listed.includes(l.id)).map((l) => `${l.id} is in no module`),
    ...listed.filter((id) => !byId.has(id)).map((id) => `module lists unknown lesson ${id}`),
    ...current.filter((l) => !content.tracks.find((t) => t.id === l.trackId)?.modules.find((m) => m.id === l.moduleId)?.lessonIds.includes(l.id)).map((l) => `${l.id} not listed in its own track/module`)];
  check("no lesson in two modules; every lesson in exactly its own module", errors, `${listed.length} module slots for ${current.length} lessons`);
}
{
  const errors: string[] = [], root = resolve(backend, "learning/content"), seen = new Set<string>();
  for await (const file of new Bun.Glob("*/lessons/*.ts").scan({ cwd: root, absolute: true })) {
    const authored = Object.values(await import(pathToFileURL(file).href)).filter((v): v is LearningLesson => !!v && typeof v === "object" && "contentVersion" in v && "kind" in v);
    if (authored.length !== 1) { errors.push(`${file}: ${authored.length} lessons exported`); continue; }
    const l = authored[0]!, key = `${l.id}@${l.contentVersion}`;
    if (seen.has(key)) errors.push(`${key} authored twice`);
    seen.add(key);
    if (JSON.stringify(LEARNING_REGISTRY.findLesson(l.id, l.contentVersion)) !== JSON.stringify(l)) errors.push(`${key} source is not registered and resolvable`);
  }
  for (const l of all) if (!seen.has(`${l.id}@${l.contentVersion}`)) errors.push(`${l.id}@${l.contentVersion} registered without a lesson source file`);
  check("every lesson source file is registered once and every registered version has a source", errors, `${seen.size} source versions vs ${all.length} registered`);
}

// ---- labs, pins, hashes
{
  const errors: string[] = [];
  for (const lab of labs) {
    const id = labOf(lab)!, latest = REGISTRY.latest(id), pin = REVIEWED_CHALLENGES[`${lab.id}@${lab.contentVersion}`];
    if (!latest) { errors.push(`${lab.id}: challenge ${id} missing`); continue; }
    if (!pin) { errors.push(`${lab.id}@${lab.contentVersion}: no reviewed pin`); continue; }
    if (pin.challengeId !== id || pin.version !== latest.definition.version) errors.push(`${lab.id}: pin names ${pin.challengeId}@${pin.version}, latest is ${id}@${latest.definition.version}`);
    if (pin.hash !== specHash(latest.definition)) errors.push(`${lab.id}: pin hash differs from specHash of ${id}@${latest.definition.version}`);
  }
  check("every executable lab maps to an existing latest challenge and a reviewed pin lessonId@contentVersion whose hash equals specHash", errors, `${labs.length} labs`);
}
{
  const errors: string[] = [];
  for (const [key, pin] of Object.entries(REVIEWED_CHALLENGES)) {
    const e = REGISTRY.find(pin.challengeId, pin.version);
    if (!e) errors.push(`${key}: ${pin.challengeId}@${pin.version} does not resolve`);
    else if (e.hash !== pin.hash) errors.push(`${key}: pin hash differs from ${pin.challengeId}@${pin.version}`);
    const [lessonId, version] = [key.slice(0, key.lastIndexOf("@")), Number(key.slice(key.lastIndexOf("@") + 1))];
    const lesson = all.find((l) => l.id === lessonId && l.contentVersion === version);
    if (!lesson) errors.push(`${key}: no such lesson version`);
    else if (labOf(lesson) !== pin.challengeId) errors.push(`${key}: lesson teaches ${labOf(lesson)}, pin names ${pin.challengeId}`);
  }
  const archivedLabs = all.filter((l) => l.kind === "executable-lab" && !current.includes(l));
  for (const l of archivedLabs) if (!REVIEWED_CHALLENGES[`${l.id}@${l.contentVersion}`]) errors.push(`archived lab ${l.id}@${l.contentVersion} has no reviewed pin`);
  check("every reviewed pin (current and archived) resolves, keeps its hash and belongs to the lesson version that teaches it", errors, `${Object.keys(REVIEWED_CHALLENGES).length} pins, ${archivedLabs.length} archived lab versions`);
}

// ---- published identities
const authoringSource = readFileSync(resolve(backend, "tests/challengeAuthoring.test.ts"), "utf8");
const publishedBlock = /export const PUBLISHED[^=]*=\s*\{([\s\S]*?)\n\};/.exec(authoringSource)![1]!;
const PUBLISHED: Record<string, string> = Object.fromEntries([...publishedBlock.matchAll(/"([a-z0-9-]+@\d+)":\s*"([a-f0-9]{64})"/g)].map((m) => [m[1]!, m[2]!]));
const rejoin = JSON.parse(readFileSync(resolve(backend, "tests/databaseRejoinLegacy.pins.json"), "utf8")) as { base: string; identities: [string, number, string][] };
const rejoinPins: Record<string, string> = Object.fromEntries(rejoin.identities.map(([id, v, h]) => [`${id}@${v}`, h]));
{
  const errors: string[] = [];
  for (const [key, hash] of Object.entries(PUBLISHED)) {
    const [id, v] = [key.slice(0, key.indexOf("@")), Number(key.slice(key.indexOf("@") + 1))], e = REGISTRY.find(id, v);
    if (!e) errors.push(`${key}: published version no longer resolves`); else if (e.hash !== hash) errors.push(`${key}: hash changed`);
  }
  for (const d of CHALLENGE_VERSIONS) if (!PUBLISHED[`${d.id}@${d.version}`]) errors.push(`${d.id}@${d.version} is not in the PUBLISHED map`);
  check("every PUBLISHED-map identity (tests/challengeAuthoring.test.ts) keeps its hash and every version is pinned", errors, `${Object.keys(PUBLISHED).length} pinned of ${CHALLENGE_VERSIONS.length} versions`);
}
{
  const errors: string[] = [];
  for (const [key, hash] of Object.entries(rejoinPins)) {
    const [id, v] = [key.slice(0, key.indexOf("@")), Number(key.slice(key.indexOf("@") + 1))], e = REGISTRY.find(id, v);
    if (!e) errors.push(`${key}: no longer resolves`); else if (e.hash !== hash) errors.push(`${key}: hash changed since ${rejoin.base.slice(0, 7)}`);
  }
  check(`every databaseRejoinLegacy.pins.json identity keeps its hash (frozen at ${rejoin.base.slice(0, 7)})`, errors, `${Object.keys(rejoinPins).length} identities`);
}
{
  const errors: string[] = [], versions = new Map<string, number[]>();
  for (const d of CHALLENGE_VERSIONS) versions.set(d.id, [...(versions.get(d.id) ?? []), d.version]);
  for (const [id, list] of versions) {
    const sorted = [...list].sort((a, b) => a - b);
    sorted.forEach((v, i) => { if (v !== i + 1) errors.push(`${id}: versions ${sorted.join(",")} have a gap`); });
    for (const v of sorted) if (!REGISTRY.find(id, v)) errors.push(`${id}@${v} not resolvable`);
  }
  check("old challenge versions remain resolvable and contiguous from 1", errors, `${versions.size} ids, ${CHALLENGE_VERSIONS.length} versions`);
}

// ---- links and prerequisites
{
  const errors: string[] = [];
  for (const l of current) {
    for (const p of l.prerequisites) {
      const q = byId.get(p);
      if (!q) errors.push(`${l.id}: prerequisite ${p} does not exist`);
      else if (rank[q.level]! > rank[l.level]!) errors.push(`${l.id} (${l.level}) -> ${p} (${q.level}): upward prerequisite`);
    }
  }
  check("every prerequisite resolves; no upward prerequisites (none grandfathered)", errors, `${current.reduce((n, l) => n + l.prerequisites.length, 0)} prerequisite links`);
}
{
  const errors: string[] = []; let links = 0;
  for (const l of current) {
    const text = l.followUp ?? "";
    for (const m of text.matchAll(/\(([a-z0-9]+(?:-[a-z0-9]+)+)\)/g)) { links++; if (!byId.has(m[1]!) && !latestChallenge(m[1]!)) errors.push(`${l.id}: follow-up (${m[1]}) does not resolve`); }
    for (const m of [...l.problem, ...l.explanation, ...l.limitations, text].join(" ").matchAll(/\/learn\/lessons\/([^\s/?#)\]<>"']+)/g)) { links++; if (!byId.has(decodeURIComponent(m[1]!))) errors.push(`${l.id}: dead lesson link ${m[1]}`); }
  }
  check("every follow-up link and in-text lesson link resolves", errors, `${links} explicit links (bare slugs in prose are covered by tests/learningIntegrity.test.ts)`);
}
{
  const errors: string[] = [];
  for (const t of content.tracks) for (const m of t.modules) for (let i = 1; i < m.lessonIds.length; i++) {
    const a = byId.get(m.lessonIds[i - 1]!), b = byId.get(m.lessonIds[i]!);
    if (a && b && rank[a.level]! > rank[b.level]!) errors.push(`${t.id}/${m.id}: level decreases ${a.id} -> ${b.id}`);
  }
  check("levels never decrease inside a module", errors, `${content.tracks.reduce((n, t) => n + t.modules.length, 0)} modules`);
}

// ---- orphan labs and lab-less challenges
{
  const errors = labs.filter((l) => !listed.includes(l.id)).map((l) => `${l.id}: lab lesson without a module`);
  check("no orphan lab lesson (every lab is listed in a module)", errors, `${labs.length} labs`);
}
const taught = new Set(all.filter((l) => l.kind === "executable-lab").map((l) => labOf(l)!));
const latestEntries = REGISTRY.listLatest();
const baseFiles = (() => { try { return execFileSync("git", ["-C", backend, "ls-tree", "-r", "--name-only", base, "--", "challenges/definitions"], { encoding: "utf8" }).split("\n"); } catch { return null; } })();
const releasedAtBase = new Set((baseFiles ?? []).map((f) => /challenges\/definitions\/([a-z0-9-]+)\/v(\d+)\.ts$/.exec(f)).filter(Boolean).map((m) => `${m![1]}@${m![2]}`));
const labless = latestEntries.filter((e) => !taught.has(e.definition.id)).map((e) => e.definition);
{
  const errors: string[] = [];
  for (const d of labless) {
    if (baseFiles && !releasedAtBase.has(`${d.id}@${d.version}`) && ![...releasedAtBase].some((k) => k.startsWith(`${d.id}@`))) errors.push(`${d.id}: lab-less and NOT part of the released tree ${base}; a new challenge needs a lab`);
    if (Object.values(REVIEWED_CHALLENGES).some((p) => p.challengeId === d.id)) errors.push(`${d.id}: lab-less but has a reviewed pin`);
  }
  check(`lab-less challenges are only the catalogue challenges already released at ${base} and have no reviewed pin`, errors, `${labless.length} lab-less of ${latestEntries.length} distinct`);
  for (const d of labless) console.log(`        . ${d.id}@${d.version} [${categoryOf(d)}, ${d.difficulty}] - free-design catalogue challenge ("${d.title}"): learners attempt it from the Challenges list, not as a guided one-change lab; it has no reviewed lesson pin by design`);
}
{
  const errors: string[] = [];
  for (const id of taught) if (!latestChallenge(id)) errors.push(`${id}: taught but missing`);
  check("every taught challenge id exists", errors, `${taught.size} challenge ids taught (current+archived lab versions)`);
}

// ---- archived (version-forward) lessons
{
  const errors: string[] = [], archivedIds = new Set(archived.map((l) => l.id));
  for (const l of current) {
    const olds = archived.filter((a) => a.id === l.id).map((a) => a.contentVersion).sort((a, b) => a - b);
    const want = Array.from({ length: l.contentVersion - 1 }, (_, i) => i + 1);
    if (JSON.stringify(olds) !== JSON.stringify(want)) errors.push(`${l.id}@${l.contentVersion}: archived versions [${olds.join(",")}], expected [${want.join(",")}]`);
    if (LEARNING_REGISTRY.findLesson(l.id)?.contentVersion !== l.contentVersion) errors.push(`${l.id}: current version is not the one registered as current`);
    for (const v of olds) {
      const a = LEARNING_REGISTRY.findLesson(l.id, v);
      if (!a || a.contentVersion !== v) errors.push(`${l.id}@${v}: old version not resolvable`);
      if (current.some((c) => c.id === l.id && c.contentVersion === v)) errors.push(`${l.id}@${v}: superseded version also listed current`);
    }
  }
  for (const id of archivedIds) if (!byId.has(id)) errors.push(`${id}: archived without a current lesson`);
  check("version-forward lessons: every old version archived once and resolvable, the new version is the only current one", errors, `${archivedIds.size} lessons carry ${archived.length} archived versions; ${current.filter((l) => l.contentVersion > 1).length} lessons above v1`);
}

// ---- counts
const published = CHALLENGE_VERSIONS.filter((d) => PUBLISHED[`${d.id}@${d.version}`] || rejoinPins[`${d.id}@${d.version}`]);
const unpublished = CHALLENGE_VERSIONS.length - published.length;
const inReleased = baseFiles ? CHALLENGE_VERSIONS.filter((d) => releasedAtBase.has(`${d.id}@${d.version}`)) : [];
console.log("\nFINAL COUNTS (from registry code)");
console.log(`tracks ${content.tracks.length}, modules ${content.tracks.reduce((n, t) => n + t.modules.length, 0)}`);
console.log(`lessons ${current.length} current + ${archived.length} archived versions = ${all.length} lesson versions (kinds ${JSON.stringify(current.reduce<Record<string, number>>((a, l) => ({ ...a, [l.kind]: (a[l.kind] ?? 0) + 1 }), {}))})`);
console.log(`runnable labs (current executable-lab lessons) ${labs.length}; lab versions incl. archived ${all.filter((l) => l.kind === "executable-lab").length}`);
console.log(`challenges ${latestEntries.length} distinct ids, ${CHALLENGE_VERSIONS.length} versions; taught by a lab ${taught.size}, lab-less ${labless.length}`);
console.log(`published versions (in PUBLISHED map or rejoin pins file) ${published.length}, unpublished ${unpublished}`);
console.log(baseFiles ? `released in base tree ${base}: ${inReleased.length} versions; added since, not yet released: ${CHALLENGE_VERSIONS.length - inReleased.length}` : `(base ${base} not available in this checkout; released split skipped)`);
console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
