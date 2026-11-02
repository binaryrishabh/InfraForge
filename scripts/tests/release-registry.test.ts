import { afterEach, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { prepareReleaseImage } from "../release/image";
import { APPROVED_IMAGE_REPOSITORY, APPROVED_IMAGE_SOURCE, approvedImageReference, pullApprovedImage } from "../release/registry";
import * as releaseProcess from "../release/process";
import * as build from "../release/build";
import { publishReleaseImage, verifyPublishedImage } from "../deploy/image";

const sha = "a".repeat(40), other = "b".repeat(40);
const digest = `sha256:${"c".repeat(64)}`, reference = `${APPROVED_IMAGE_REPOSITORY}@${digest}`;
const imageId = `sha256:${"d".repeat(64)}`;
type Behaviour = { labels?: Record<string, string>; repoDigests?: string[]; architecture?: string; hostArchitecture?: string;
  pullFails?: boolean; loginFails?: boolean; metadata?: Record<string, unknown>; id?: string };
const goodLabels = () => ({ "org.opencontainers.image.source": APPROVED_IMAGE_SOURCE, "org.opencontainers.image.revision": sha });

function fakeDocker(behaviour: Behaviour = {}) {
  const calls: { args: string[]; input?: string; config?: string }[] = [];
  const mock = spyOn(releaseProcess, "command").mockImplementation(async (args: string[], _cwd?: string, _env?: unknown, _diagnostics?: string, input?: string) => {
    const configAt = args.indexOf("--config"), config = configAt > 0 ? args[configAt + 1] : undefined;
    const rest = configAt > 0 ? [args[0]!, ...args.slice(configAt + 2)] : args;
    calls.push({ args, ...(input === undefined ? {} : { input }), ...(config ? { config } : {}) });
    const verb = rest[1];
    if (verb === "login") { if (behaviour.loginFails) throw new Error("docker login failed; unauthorized"); return "Login Succeeded"; }
    if (verb === "pull") { if (behaviour.pullFails) throw new Error("docker pull failed; manifest unknown"); return reference; }
    if (verb === "logout") return "";
    if (verb === "version") return behaviour.hostArchitecture ?? "amd64";
    if (verb === "tag") return "";
    if (verb === "run") return JSON.stringify(behaviour.metadata ?? { sha, migrationFingerprint: "schema", authContract: 1 });
    if (verb === "image" && rest[2] === "inspect") {
      return JSON.stringify([{ Id: behaviour.id ?? imageId, Architecture: behaviour.architecture ?? "amd64", RepoDigests: behaviour.repoDigests ?? [reference],
        Config: { Labels: behaviour.labels ?? goodLabels() } }]);
    }
    throw new Error(`Unexpected command: ${rest.join(" ")}`);
  });
  return { calls, mock, verbs: () => calls.map(c => (c.config ? [c.args[0], ...c.args.slice(c.args.indexOf("--config") + 2)] : c.args)[1]) };
}
afterEach(() => { spyOn(releaseProcess, "command").mockRestore(); });

test("only an exact pinned digest of the approved repository is acceptable", () => {
  expect(approvedImageReference(reference)).toBe(reference);
  for (const bad of [undefined, "", `${APPROVED_IMAGE_REPOSITORY}:latest`, `${APPROVED_IMAGE_REPOSITORY}:${sha}`, `${APPROVED_IMAGE_REPOSITORY}@sha256:${"c".repeat(63)}`,
    `${APPROVED_IMAGE_REPOSITORY}@sha256:${"C".repeat(64)}`, `ghcr.io/someone/else@${digest}`, `docker.io/library/bun@${digest}`, `${reference} --privileged`, `${reference}\n`]) {
    expect(() => approvedImageReference(bad)).toThrow("approved exact image digest");
  }
});

test("a production apply never builds: no reference refuses before any docker command", async () => {
  const docker = fakeDocker();
  const rebuilt = spyOn(build, "buildReleaseImage").mockRejectedValue(new Error("The production host must not build"));
  try {
    await expect(prepareReleaseImage("apply", sha, undefined, ".")).rejects.toThrow("never builds");
    await expect(prepareReleaseImage("apply", sha, undefined, ".", { reference: `${APPROVED_IMAGE_REPOSITORY}:latest` })).rejects.toThrow("approved exact image digest");
    expect(rebuilt).not.toHaveBeenCalled();
    expect(docker.calls).toHaveLength(0);
  } finally { rebuilt.mockRestore(); }
});

test("the exact digest is pulled, verified, tagged by content ID, and the token only ever travels on stdin", async () => {
  const docker = fakeDocker();
  const token = "ghs_SECRET_TOKEN_VALUE";
  const local = await pullApprovedImage(reference, sha, ".", { user: "octo", token });
  expect(local).toBe(`infraforge-backend:${sha}`);
  expect(docker.verbs()).toEqual(["login", "pull", "image", "version", "tag", "logout"]);
  expect(docker.calls.find(c => c.args.includes("pull"))?.args.at(-1)).toBe(reference);
  expect(docker.calls.find(c => c.args.includes("tag"))?.args.slice(-2)).toEqual([imageId, `infraforge-backend:${sha}`]);
  expect(docker.calls.some(c => c.args.join(" ").includes(token))).toBe(false);
  expect(docker.calls.find(c => c.args.includes("login"))?.input).toBe(token);
  expect(docker.calls.find(c => c.args.includes("login"))?.args).toContain("--password-stdin");
  expect(docker.calls.some(c => c.args.includes("build"))).toBe(false);
  const config = docker.calls[0]!.config!;
  expect(existsSync(config)).toBe(false);
});

test("a wrong digest, source, revision, platform or test-only image is refused before it can be tagged", async () => {
  const cases: [string, Behaviour, string][] = [
    ["digest", { repoDigests: [`${APPROVED_IMAGE_REPOSITORY}@sha256:${"e".repeat(64)}`] }, "approved digest"],
    ["source", { labels: { ...goodLabels(), "org.opencontainers.image.source": "https://github.com/someone/else" } }, "source"],
    ["revision", { labels: { ...goodLabels(), "org.opencontainers.image.revision": other } }, "revision"],
    ["missing labels", { labels: {} }, "source"],
    ["architecture", { architecture: "arm64" }, "architecture arm64 does not match this host (amd64)"],
    ["host architecture unknown", { hostArchitecture: "" }, "architecture"],
    ["rehearsal", { labels: { ...goodLabels(), "org.infraforge.rehearsal": "x" } }, "Test-only"],
    ["image ID", { id: "not-a-content-id" }, "approved digest"],
  ];
  for (const [name, behaviour, message] of cases) {
    const docker = fakeDocker(behaviour);
    await expect(pullApprovedImage(reference, sha, ".", { user: "u", token: "t" }), name).rejects.toThrow(message);
    expect(docker.verbs(), name).not.toContain("tag");
    expect(docker.verbs().at(-1), name).toBe("logout");
    spyOn(releaseProcess, "command").mockRestore();
  }
});

test("registry, authentication and interrupted-pull failures stop before anything is tagged or accepted", async () => {
  for (const behaviour of [{ pullFails: true }, { loginFails: true }] as Behaviour[]) {
    const docker = fakeDocker(behaviour);
    await expect(prepareReleaseImage("apply", sha, undefined, ".", { reference, auth: { user: "u", token: "t" } })).rejects.toThrow(/failed/);
    expect(docker.verbs()).not.toContain("tag");
    expect(docker.verbs()).not.toContain("run");
    expect(docker.verbs().at(-1)).toBe("logout");
    expect(docker.calls.some(c => c.args.includes("compose") || c.args.includes("stop"))).toBe(false);
    spyOn(releaseProcess, "command").mockRestore();
  }
});

test("embedded release metadata is still verified after the pull", async () => {
  for (const [metadata, message] of [
    [{ sha: other, migrationFingerprint: "schema", authContract: 1 }, "Embedded release metadata"],
    [{ sha, migrationFingerprint: "", authContract: 1 }, "Embedded release metadata"],
    [{ sha, migrationFingerprint: "schema", authContract: 2 }, "Embedded release metadata"],
  ] as [Record<string, unknown>, string][]) {
    fakeDocker({ metadata });
    await expect(prepareReleaseImage("apply", sha, undefined, ".", { reference })).rejects.toThrow(message);
    spyOn(releaseProcess, "command").mockRestore();
  }
});

test("a good pull yields the same accepted-record shape and keeps local rollback material", async () => {
  fakeDocker();
  const next = await prepareReleaseImage("apply", sha, { current: { sha: other, image: "infraforge-backend:old", imageId: `sha256:${"f".repeat(64)}`,
    migrationFingerprint: "schema", authContract: 1, settingsFingerprint: "s" } }, ".", { reference });
  expect(Object.keys(next).sort()).toEqual(["authContract", "image", "imageId", "migrationFingerprint", "settingsFingerprint", "sha"]);
  expect(next).toMatchObject({ sha, image: `infraforge-backend:${sha}`, imageId, migrationFingerprint: "schema", authContract: 1 });
});

test("retained SHAs still refuse a new apply and reconfigure never touches the registry", async () => {
  const docker = fakeDocker();
  const accepted = { sha, image: "infraforge-backend:x", imageId, migrationFingerprint: "schema", authContract: 1, settingsFingerprint: "s" };
  await expect(prepareReleaseImage("apply", sha, { current: accepted }, ".", { reference })).rejects.toThrow("retained accepted");
  expect(docker.calls.some(c => c.args.includes("pull"))).toBe(false);
});

test("no production setting or secret can enter the image build", () => {
  const dockerfile = readFileSync("apps/backend/Dockerfile", "utf8"), ignore = readFileSync(".dockerignore", "utf8");
  expect(dockerfile).not.toMatch(/release\.env|\.env|COPY \.\s|secret|TOKEN|PASSWORD/i);
  expect(dockerfile).toContain("ARG RELEASE_SHA");
  expect(ignore).toMatch(/\.env/);
});

test("the release workflow publishes off-host and the host script never builds or exposes the token", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  const host = workflow.slice(workflow.indexOf("- name: Release exact backend commit"), workflow.indexOf("- name: Independently verify public backend"));
  expect(host).not.toMatch(/docker build|buildx|docker push/);
  expect(host).toContain("RELEASE_REGISTRY_AUTH=stdin");
  expect(host).toContain("unset REGISTRY_TOKEN");
  expect(host).not.toMatch(/echo[^\n]*(registry_token|REGISTRY_TOKEN)|set -x/);
  const image = workflow.slice(workflow.indexOf("\n  image:"), workflow.indexOf("\n  release:"));
  expect(image).toContain("packages: write");
  expect(image).toContain("scripts/deploy/image.ts publish");
  const release = workflow.slice(workflow.indexOf("\n  release:"));
  expect(release).toContain("needs: [release-gate, image]");
  expect(release).toContain("packages: read");
  expect(release).not.toContain("packages: write");
  // A job-level permissions block replaces the defaults, so the release job must restate what it already needs.
  const permissions = release.slice(release.indexOf("permissions:"), release.indexOf("env:"));
  for (const need of ["contents: read", "actions: read", "deployments: read", "packages: read"]) expect(permissions).toContain(need);
  expect(permissions).not.toMatch(/write/);
  expect(image.slice(image.indexOf("permissions:"), image.indexOf("outputs:")).replace(/\s+/g, " ").trim()).toBe("permissions: contents: read packages: write");
  // The release job proves its own token can read the exact digest before Tailscale, SSH, backup or any host command.
  const proof = release.indexOf("Prove this job can pull the exact approved image");
  expect(proof).toBeGreaterThan(0);
  for (const later of ["Join Tailscale for the home server", "Release exact backend commit"]) expect(proof).toBeLessThan(release.indexOf(later));
  expect(release.slice(proof, release.indexOf("- name:", proof + 10))).toContain("REGISTRY_TOKEN: ${{ github.token }}");
  expect(release.slice(proof, release.indexOf("- name:", proof + 10))).toContain("scripts/deploy/image.ts verify");
  expect(release).toContain("RELEASE_IMAGE: ${{ needs.image.outputs.reference }}");
});

test("the runner publishes only a verified build and outputs the immutable digest", async () => {
  const calls: string[][] = [];
  const env = { REGISTRY_USER: "octo", REGISTRY_TOKEN: "ghs_RUNNER_TOKEN", GITHUB_RUN_ID: "7", GITHUB_RUN_ATTEMPT: "2" };
  const make = (labels: Record<string, string>, metadata: Record<string, unknown>, digests: string[]) => async (args: string[], _cwd: string, _e?: unknown, _d?: string, input?: string) => {
    calls.push(input === undefined ? args : [...args, `<stdin:${input === "ghs_RUNNER_TOKEN" ? "token" : "other"}>`]);
    const verb = args[args.indexOf("--config") + 2] ?? args[1];
    if (verb === "image") return JSON.stringify([{ Id: imageId, Architecture: "amd64", RepoDigests: digests, Config: { Labels: labels } }]);
    if (verb === "run") return JSON.stringify(metadata);
    return "";
  };
  const ok = await publishReleaseImage(sha, make(goodLabels(), { sha, migrationFingerprint: "m", authContract: 1 }, [reference]) as never, ".", env);
  expect(ok).toEqual({ reference, architecture: "amd64" });
  const flat = calls.map(c => c.join(" "));
  expect(flat.find(c => c.includes(" build "))).toContain(`${APPROVED_IMAGE_REPOSITORY}:sha-${sha}-7-2`);
  expect(flat.some(c => c.includes("ghs_RUNNER_TOKEN"))).toBe(false);
  expect(flat.findIndex(c => c.includes(" run "))).toBeLessThan(flat.findIndex(c => c.includes(" push ")));
  expect(flat.at(-1)).toContain("logout");
  for (const [labels, metadata, digests, message] of [
    [{ ...goodLabels(), "org.opencontainers.image.revision": other }, { sha, migrationFingerprint: "m", authContract: 1 }, [reference], "labels"],
    [goodLabels(), { sha: other, migrationFingerprint: "m", authContract: 1 }, [reference], "metadata"],
    [goodLabels(), { sha, migrationFingerprint: "m", authContract: 1 }, [], "immutable digest"],
  ] as [Record<string, string>, Record<string, unknown>, string[], string][]) {
    calls.length = 0;
    await expect(publishReleaseImage(sha, make(labels, metadata, digests) as never, ".", env)).rejects.toThrow(message);
    if (message !== "immutable digest") expect(calls.some(c => c.includes("push"))).toBe(false);
  }
  await expect(publishReleaseImage(sha, make({}, {}, []) as never, ".", { ...env, REGISTRY_TOKEN: undefined })).rejects.toThrow("credentials");
});

test("the release job proves read access to the exact digest and verifies repository, source, revision and metadata before production", async () => {
  const calls: string[][] = [];
  const env = { REGISTRY_USER: "octo", REGISTRY_TOKEN: "ghs_RELEASE_JOB_TOKEN" };
  const make = (behaviour: { labels?: Record<string, string>; metadata?: Record<string, unknown>; pullFails?: boolean }) => async (args: string[], _cwd: string, _e?: unknown, _d?: string, input?: string) => {
    calls.push(args);
    const configAt = args.indexOf("--config"), verb = configAt > 0 ? args[configAt + 2] : args[1];
    if (verb === "login") { expect(input).toBe(env.REGISTRY_TOKEN); expect(args.join(" ")).not.toContain(env.REGISTRY_TOKEN); return ""; }
    if (verb === "pull") { if (behaviour.pullFails) throw new Error("docker pull failed; denied: permission_denied: read_package"); return ""; }
    if (verb === "version") return "amd64";
    if (verb === "image" && (configAt > 0 ? args[configAt + 3] : args[2]) === "inspect") return JSON.stringify([{ Id: imageId, Architecture: "amd64", RepoDigests: [reference], Config: { Labels: behaviour.labels ?? goodLabels() } }]);
    if (verb === "run") return JSON.stringify(behaviour.metadata ?? { sha, migrationFingerprint: "m", authContract: 1 });
    return "";
  };
  const ok = await verifyPublishedImage(sha, reference, make({}) as never, ".", env);
  expect(ok).toEqual({ reference, migrationFingerprint: "m" });
  const flat = calls.map(c => c.join(" "));
  expect(flat.some(c => c.includes(" build "))).toBe(false);
  expect(flat.some(c => c.includes("compose") || c.includes("ssh"))).toBe(false);
  expect(flat.filter(c => c.includes("image rm"))).toHaveLength(2);
  expect(flat.some(c => c.includes("logout"))).toBe(true);
  for (const [name, behaviour, message] of [
    ["token cannot read the package", { pullFails: true }, "permission_denied"],
    ["wrong revision", { labels: { ...goodLabels(), "org.opencontainers.image.revision": other } }, "revision"],
    ["wrong source", { labels: { ...goodLabels(), "org.opencontainers.image.source": "https://github.com/x/y" } }, "source"],
    ["wrong metadata", { metadata: { sha: other, migrationFingerprint: "m", authContract: 1 } }, "Embedded release metadata"],
    ["wrong auth contract", { metadata: { sha, migrationFingerprint: "m", authContract: 2 } }, "Embedded release metadata"],
  ] as [string, { labels?: Record<string, string>; metadata?: Record<string, unknown>; pullFails?: boolean }, string][]) {
    await expect(verifyPublishedImage(sha, reference, make(behaviour) as never, ".", env), name).rejects.toThrow(message);
  }
  await expect(verifyPublishedImage(sha, `${APPROVED_IMAGE_REPOSITORY}:latest`, make({}) as never, ".", env)).rejects.toThrow("approved exact image digest");
  await expect(verifyPublishedImage(sha, reference, make({}) as never, ".", { ...env, REGISTRY_TOKEN: undefined })).rejects.toThrow("credentials");
});
