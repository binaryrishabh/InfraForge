import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const compose = Bun.YAML.parse(readFileSync("ops/compose.dev.yml", "utf8")) as {
  services: Record<"postgres" | "redis", { image: string }>;
};
const ownership = { "infraforge.project": "binaryrishabh/InfraForge", "infraforge.purpose": "development" };
function resources() {
  return Object.fromEntries((["postgres", "redis"] as const).map((service) => {
    const postgres = service === "postgres";
    return [`infraforge-dev-${service}`, {
      Config: { Image: compose.services[service].image, Labels: { ...ownership,
        "com.docker.compose.project": "infraforge-dev", "com.docker.compose.service": service } },
      HostConfig: { PortBindings: { [postgres ? "5432/tcp" : "6379/tcp"]: [
        { HostIp: "127.0.0.1", HostPort: postgres ? "55432" : "56379" },
      ] } },
      Mounts: postgres ? [{ Type: "volume", Name: "infraforge-dev-postgres-data", Destination: "/var/lib/postgresql" }] : [],
      State: { Running: true },
    }];
  }));
}
type Resources = ReturnType<typeof resources>;
const cases: { Name: string; Resources: Resources; ComposeFailure?: boolean; Compose?: typeof compose }[] = [];
function scenario(name: string, edit: (value: Resources) => void = () => {}) {
  const value = resources();
  edit(value);
  cases.push({ Name: name, Resources: value });
}
scenario("exact repository pins");
scenario("exact pins and owned volume/network", (value) => {
  Object.assign(value, { "infraforge-dev-postgres-data": { Labels: ownership }, "infraforge-dev-network": { Labels: ownership } });
});
for (const service of ["postgres", "redis"] as const) {
  const name = `infraforge-dev-${service}`;
  scenario(`${service}: wrong service image`, (value) => { value[name]!.Config.Image = compose.services[service === "postgres" ? "redis" : "postgres"].image; });
  scenario(`${service}: wrong digest`, (value) => { value[name]!.Config.Image = `${compose.services[service].image.split("@")[0]}@sha256:${"0".repeat(64)}`; });
  scenario(`${service}: unpinned tag`, (value) => { value[name]!.Config.Image = compose.services[service].image.split("@")[0]!; });
  scenario(`${service}: missing ownership labels`, (value) => { Object.assign(value[name]!.Config, { Labels: null }); });
  for (const image of [compose.services[service].image.split("@")[0]!, compose.services[service === "postgres" ? "redis" : "postgres"].image]) {
    const invalid = structuredClone(compose);
    invalid.services[service].image = image;
    cases.push({ Name: `${service}: invalid Compose identity ${image}`, Resources: resources(), Compose: invalid });
  }
  for (const label of Object.keys(resources()[name]!.Config.Labels)) {
    scenario(`${service}: missing ${label}`, (value) => { delete (value[name]!.Config.Labels as Record<string, string>)[label]; });
    scenario(`${service}: wrong ${label}`, (value) => { (value[name]!.Config.Labels as Record<string, string>)[label] = "unknown"; });
  }
  scenario(`${service}: public port`, (value) => { Object.values(value[name]!.HostConfig.PortBindings)[0]![0]!.HostIp = "0.0.0.0"; });
  scenario(`${service}: wrong port`, (value) => { Object.values(value[name]!.HostConfig.PortBindings)[0]![0]!.HostPort = "12345"; });
  scenario(`${service}: extra binding`, (value) => { Object.values(value[name]!.HostConfig.PortBindings)[0]!.push({ HostIp: "127.0.0.1", HostPort: "12345" }); });
}
scenario("wrong data volume", (value) => { value["infraforge-dev-postgres"]!.Mounts[0]!.Name = "unknown"; });
scenario("wrong mount type", (value) => { value["infraforge-dev-postgres"]!.Mounts[0]!.Type = "bind"; });
scenario("missing data volume", (value) => { value["infraforge-dev-postgres"]!.Mounts = []; });
// Non-container resources need only Labels; keep their fixture type separate.
const nonContainers = ["infraforge-dev-postgres-data", "infraforge-dev-network"];
for (const name of nonContainers) {
  for (const labels of [null, { ...ownership, "infraforge.project": "unknown" }, { ...ownership, "infraforge.purpose": "unknown" }]) {
    const value = resources();
    Object.assign(value, { [name]: { Labels: labels } });
    cases.push({ Name: `${name}: ${JSON.stringify(labels)}`, Resources: value });
  }
}
cases.push({ Name: "compose rendering failure", Resources: resources(), ComposeFailure: true });
const child = Bun.spawnSync([process.env.PWSH_PATH ?? "pwsh", "-NoProfile", "-File", "scripts/tests/fixtures/development-resources.ps1"], {
  stdin: new TextEncoder().encode(JSON.stringify({ Compose: compose, Cases: cases })),
});
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const results = JSON.parse(child.stdout.toString()) as { Name: string; Error: string | null }[];

test("old bare-tag comparison rejects both current repository pins", () => {
  expect(compose.services.postgres.image).toMatch(/^postgres:18-alpine@sha256:[a-f0-9]{64}$/);
  expect(compose.services.redis.image).toMatch(/^redis:8-alpine@sha256:[a-f0-9]{64}$/);
  expect(compose.services.postgres.image).not.toBe("postgres:18-alpine");
  expect(compose.services.redis.image).not.toBe("redis:8-alpine");
});
for (const result of results) {
  test(`development resource assertion: ${result.Name}`, () => {
    if (result.Name.startsWith("exact ")) expect(result.Error).toBeNull();
    else expect(result.Error).toBeString();
  });
}
