import { expect, test } from "bun:test";
import { lessonEndpoint, dockerInvocation } from "../internalModel2/dockerEndpoint";
const selected = { MODEL2_LESSON_ENDPOINT: "unix:///run/user/1234/docker.sock" };
test("production endpoint is explicit and belongs to the current nonroot Linux account", () => {
  expect(lessonEndpoint({}, "linux", 1234)).toBeNull();
  expect(lessonEndpoint(selected, "linux", 1234)?.endpoint).toBe(selected.MODEL2_LESSON_ENDPOINT);
  expect(() => lessonEndpoint(selected, "win32", 1234)).toThrow(); expect(() => lessonEndpoint(selected, "linux", 0)).toThrow();
  for (const endpoint of ["", "tcp://localhost:2375", "ssh://user@host", "npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock", "unix:///run/user/1235/docker.sock", "unix://run/user/1234/docker.sock", "unix:///run/user/1234/../1234/docker.sock", "unix:///run/user/1234/docker.sock?x=1", "unix:///run/user/1234/docker.sock\n", "unix:///run/user/1234/%64ocker.sock"]) expect(() => lessonEndpoint({ MODEL2_LESSON_ENDPOINT: endpoint }, "linux", 1234)).toThrow();
});
test("ambient Docker settings do not select the lesson endpoint", () => {
  const env = { ...selected, DOCKER_HOST: "tcp://untrusted:2375", DOCKER_CONTEXT: "untrusted", DOCKER_CONFIG: "/untrusted", DOCKER_TLS: "1", DOCKER_TLS_VERIFY: "1", DOCKER_CERT_PATH: "/untrusted" };
  expect(lessonEndpoint(env, "linux", 1234)).toEqual(lessonEndpoint(selected, "linux", 1234));
});
test("rootful CI is an explicit restricted mode, never a production fallback", () => {
  const env = { MODEL2_LESSON_ENDPOINT: "unix:///var/run/docker.sock", MODEL2_LESSON_DOCKER_MODE: "disposable-rootful-ci", NODE_ENV: "test", CI: "true", GITHUB_ACTIONS: "true", M2M_RUN: "1", INTEGRATION_DISPOSABLE: "local-only" };
  expect(lessonEndpoint(env, "linux", 1234)?.purpose).toBe("disposable-rootful-ci");
  for (const key of ["MODEL2_LESSON_DOCKER_MODE", "NODE_ENV", "CI", "GITHUB_ACTIONS", "M2M_RUN", "INTEGRATION_DISPOSABLE"]) expect(() => lessonEndpoint({ ...env, [key]: undefined }, "linux", 1234)).toThrow();
  expect(() => lessonEndpoint({ ...env, NODE_ENV: "production" }, "linux", 1234)).toThrow();
  expect(() => lessonEndpoint({ ...selected, MODEL2_LESSON_DOCKER_MODE: "rootful" }, "linux", 1234)).toThrow();
});
test("every Docker operation gets the same explicit endpoint and private config", () => {
  const connection = lessonEndpoint(selected, "linux", 1234)!;
  for (const operation of ["create", "inspect", "ps", "start", "rm", "image", "info", "version", "cp", "commit"]) expect(dockerInvocation(connection, "/private-client", [operation, "value"]).slice(0, 4)).toEqual(["--host", selected.MODEL2_LESSON_ENDPOINT, "--config", "/private-client"]);
  for (const override of ["--host=tcp://untrusted:2375", "-Htcp://untrusted:2375", "--context", "--config=/untrusted", "--tlsverify"]) expect(() => dockerInvocation(connection, "/private-client", ["ps", override])).toThrow();
});
