import { command } from "./process";

export const localDockerEndpoint = "unix:///var/run/docker.sock";

export function localDockerEnvironment(env: Record<string, string | undefined>) {
  if (env.DOCKER_HOST && env.DOCKER_HOST !== localDockerEndpoint || env.DOCKER_CONTEXT && env.DOCKER_CONTEXT !== "default" ||
      env.DOCKER_TLS_VERIFY || env.DOCKER_CERT_PATH) throw new Error("Docker endpoint is Unknown; release requires the local default rootful endpoint");
  return { ...env, DOCKER_HOST: localDockerEndpoint, DOCKER_CONTEXT: undefined, DOCKER_TLS_VERIFY: undefined, DOCKER_CERT_PATH: undefined };
}

export async function verifyLocalDocker(root: string, run = command, env = process.env) {
  localDockerEnvironment(env);
  if ((await run(["docker", "context", "show"], root, env)).trim() !== "default") {
    throw new Error("Release requires the local default Docker context");
  }
  const contexts = JSON.parse(await run(["docker", "context", "inspect", "default"], root, env));
  if (!Array.isArray(contexts) || contexts.length !== 1 || contexts[0]?.Name !== "default" ||
      contexts[0]?.Endpoints?.docker?.Host !== localDockerEndpoint) {
    throw new Error("Release requires the local default Docker endpoint");
  }
}
