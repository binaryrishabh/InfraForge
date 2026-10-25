export const localDockerEndpoint = "unix:///var/run/docker.sock";

export function localDockerEnvironment(env: Record<string, string | undefined>) {
  if (env.DOCKER_HOST && env.DOCKER_HOST !== localDockerEndpoint || env.DOCKER_CONTEXT && env.DOCKER_CONTEXT !== "default" ||
      env.DOCKER_TLS_VERIFY || env.DOCKER_CERT_PATH) throw new Error("Docker endpoint is Unknown; release requires the local default rootful endpoint");
  return { ...env, DOCKER_HOST: localDockerEndpoint, DOCKER_CONTEXT: undefined, DOCKER_TLS_VERIFY: undefined, DOCKER_CERT_PATH: undefined };
}
