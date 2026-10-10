import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { databaseUrl, digest, CutoverError } from "../../apps/backend/cutover/database";

export type ProductionIdentity = { projectId: string; branchId: string };
type Branch = { id: string; project_id: string; parent_id?: string; name: string; default: boolean;
  protected: boolean; current_state: string };
type Endpoint = { id: string; project_id: string; branch_id: string; host: string; type: string; disabled: boolean };
export type NeonMetadata = { branch: Branch; production: Branch; endpoints: Endpoint[] };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,60}$/.test(value);

export function rehearsalWorkspace(project: string, directory: string) {
  if (!/^infraforge_rehearsal_[a-f0-9]{8}$/.test(project) || !isAbsolute(directory) ||
      /(?:^|\/)var\/lib\/infraforge\/releases(?:\/|$)/i.test(resolve(directory).replaceAll("\\", "/")) ||
      dirname(resolve(directory)) !== resolve(tmpdir()) || !/^infraforge-neon-rehearsal-[a-zA-Z0-9-]+$/.test(basename(directory))) {
    throw new CutoverError("Rehearsal requires unique local temporary state and its own Compose project; production state is forbidden");
  }
}

export async function productionIdentity(path: string | undefined, root: string): Promise<ProductionIdentity> {
  if (!path || !isAbsolute(path)) throw new CutoverError("Supply an absolute independent production identity file outside the checkout");
  const within = relative(await realpath(root), await realpath(path));
  if (within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within)) throw new CutoverError("Production identifiers must remain outside the repository");
  const data = JSON.parse(await readFile(path, "utf8"));
  if (!identifier(data.projectId) || !identifier(data.branchId) || !data.branchId.startsWith("br-")) throw new CutoverError("Invalid independent production identity");
  return { projectId: data.projectId, branchId: data.branchId };
}

export function rehearsalTarget(env: Record<string, string | undefined>, production: ProductionIdentity, metadata: NeonMetadata) {
  const project = env.REHEARSAL_PROJECT_ID;
  const branch = env.REHEARSAL_BRANCH_ID;
  const name = env.REHEARSAL_ID;
  if (!identifier(project) || !identifier(branch) || !branch.startsWith("br-") || !/^infraforge-rehearsal-[a-f0-9]{16}$/.test(name ?? "") ||
      env.REHEARSAL_DISPOSABLE !== "disposable-neon-branch") throw new CutoverError("Explicit disposable Neon rehearsal identity and marker are required");
  if (project !== production.projectId || branch === production.branchId) throw new CutoverError("Rehearsal must be a different branch of the independently identified production project");
  const target = metadata.branch;
  if (metadata.production.id !== production.branchId || metadata.production.project_id !== project || target.id !== branch ||
      target.project_id !== project || target.parent_id !== production.branchId || target.name !== name ||
      target.default !== false || target.protected !== false || target.current_state !== "ready") {
    throw new CutoverError("Neon API did not prove a ready, unprotected, non-default disposable child of production");
  }
  const urls = [env.DATABASE_URL, env.MIGRATION_DATABASE_URL, env.WORKER_DATABASE_URL].map((value, index) => {
    const url = databaseUrl(value, index > 0);
    if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) || !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname) || !url.password || url.port && url.port !== "5432") {
      throw new CutoverError("Rehearsal requires unambiguous authenticated Neon endpoints");
    }
    for (const [key, value] of url.searchParams) if (!(key === "sslmode" && value === "verify-full") && !(key === "channel_binding" && value === "require")) {
      throw new CutoverError("Unsupported connection-string options could redirect the target");
    }
    const host = url.hostname.replace(/-pooler(?=\.)/, "");
    const endpoints = metadata.endpoints.filter((item) => item.host === host);
    if (endpoints.length !== 1 || endpoints[0]!.project_id !== project || endpoints[0]!.branch_id !== branch ||
        endpoints[0]!.type !== "read_write" || endpoints[0]!.disabled !== false) throw new CutoverError("Every endpoint must be verified by Neon API as belonging to the disposable branch");
    return url;
  });
  if (urls.some((url) => url.pathname !== urls[0]!.pathname)) throw new CutoverError("Rehearsal endpoints must name the same database");
  return { urls: urls.map((url) => url.href), database: decodeURIComponent(urls[0]!.pathname.slice(1)),
    display: { host: `Neon endpoint sha256:${digest(urls[1]!.hostname).slice(0, 16)}`,
      database: `sha256:${digest(urls[0]!.pathname.slice(1)).slice(0, 16)}`, branch: digest(`${project}/${branch}`), disposable: true } };
}

export async function neonMetadata(env: Record<string, string | undefined>, production: ProductionIdentity): Promise<NeonMetadata> {
  const project = env.REHEARSAL_PROJECT_ID;
  const branch = env.REHEARSAL_BRANCH_ID;
  if (!identifier(project) || !identifier(branch) || !env.NEON_API_KEY || project !== production.projectId || branch === production.branchId) {
    throw new CutoverError("Independent production identity, disposable branch and Neon API read access are required");
  }
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`https://console.neon.tech/api/v2/projects/${project}/${path}`, {
      method: "GET", redirect: "error", headers: { Authorization: `Bearer ${env.NEON_API_KEY}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new CutoverError("Neon identity verification failed; no database mutation is permitted");
    return await response.json() as T;
  };
  const [target, source, endpoints] = await Promise.all([get<{ branch: Branch }>(`branches/${branch}`),
    get<{ branch: Branch }>(`branches/${production.branchId}`), get<{ endpoints: Endpoint[] }>("endpoints")]);
  return { branch: target.branch, production: source.branch, endpoints: endpoints.endpoints };
}
