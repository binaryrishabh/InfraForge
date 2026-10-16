export interface DockerEndpoint { readonly endpoint: string; readonly socket: string; readonly uid: number; readonly purpose: "rootless" | "disposable-rootful-ci" }
export function lessonEndpoint(env: NodeJS.ProcessEnv = process.env, platform = process.platform, uid = process.getuid?.()): DockerEndpoint | null {
  const endpoint = env.MODEL2_LESSON_ENDPOINT;
  if (endpoint === undefined) return null;
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid! <= 0) throw Error("Lesson Docker requires a dedicated nonroot Linux account");
  const purpose = env.MODEL2_LESSON_DOCKER_MODE ?? "rootless";
  if (purpose === "disposable-rootful-ci") {
    if (env.NODE_ENV !== "test" || env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.M2M_RUN !== "1" || env.INTEGRATION_DISPOSABLE !== "local-only" || endpoint !== "unix:///var/run/docker.sock") throw Error("Rootful lesson Docker is restricted to explicit disposable GitHub CI");
  } else if (purpose !== "rootless" || endpoint !== `unix:///run/user/${uid}/docker.sock`) throw Error("Pin MODEL2_LESSON_ENDPOINT to this account's /run/user/UID/docker.sock; no endpoint fallback");
  return Object.freeze({ endpoint, socket: endpoint.slice("unix://".length), uid: uid!, purpose });
}
export function dockerInvocation(connection: DockerEndpoint, config: string, args: readonly string[]) {
  if (!args.length || args[0]!.startsWith("-") || args.some((s) => /^(-H|--host(?:=|$)|--context(?:=|$)|--config(?:=|$)|--tls)/.test(s))) throw Error("Docker endpoint/config overrides are forbidden");
  return ["--host", connection.endpoint, "--config", config, ...args];
}
