import { digest } from "./hash";

type Dependencies = Record<string, string>;
export interface Manifest {
  name: string; dependencies?: Dependencies; optionalDependencies?: Dependencies; peerDependencies?: Dependencies;
  [key: string]: unknown;
}
export type PackageRecord = [string, string?, {
  dependencies?: Dependencies; optionalDependencies?: Dependencies; peerDependencies?: Dependencies;
  optionalPeers?: string[]; [key: string]: unknown;
}?, string?];
export interface Lock {
  lockfileVersion: number; configVersion: number; workspaces: Record<string, Manifest>;
  packages: Record<string, PackageRecord>; overrides?: Dependencies; [key: string]: unknown;
}
export interface Edge { name: string; range: string; kind: string; target: string | null }
export interface Instance { id: string; name: string; version: string; integrity: string; record: PackageRecord; edges: Edge[] }

export function parseLock(text: string): Lock {
  const lock = Bun.JSONC.parse(text) as Lock;
  if (lock.lockfileVersion !== 1 || lock.configVersion !== 1 || !lock.packages || !lock.workspaces) throw Error("Unsupported Bun lock schema");
  const known = ["lockfileVersion", "configVersion", "workspaces", "packages", "overrides"];
  for (const key of Object.keys(lock)) if (!known.includes(key)) throw Error(`Unreviewed lock setting: ${key}`);
  return lock;
}

// Bun lock keys encode nested instances (including scoped names), not version ranges.
export function resolveInstance(lock: Lock, parent: string, name: string): string | undefined {
  let scope = parent;
  while (scope) {
    const candidate = `${scope}/${name}`;
    if (lock.packages[candidate]) return candidate;
    const parts = scope.split("/");
    parts.pop();
    if (parts.at(-1)?.startsWith("@")) parts.pop();
    scope = parts.join("/");
  }
  return lock.packages[name] ? name : undefined;
}

export function dependencyClosure(lock: Lock, roots: Record<string, Dependencies>) {
  const instances = new Map<string, Instance>();
  function edges(parent: string, metadata: NonNullable<PackageRecord[2]>): Edge[] {
    return ["dependencies", "optionalDependencies", "peerDependencies"].flatMap(kind =>
      Object.entries((metadata[kind] ?? {}) as Dependencies).sort(([a], [b]) => a.localeCompare(b)).map(([name, range]) => {
        const target = resolveInstance(lock, parent, name);
        const optional = kind === "peerDependencies" && metadata.optionalPeers?.includes(name);
        if (!target && !optional) throw Error(`Unresolved ${kind}: ${parent} -> ${name}`);
        if (target) visit(target);
        return { name, range, kind, target: target ?? null };
      }));
  }
  function visit(id: string) {
    if (instances.has(id)) return;
    const record = lock.packages[id]!;
    const split = record[0].lastIndexOf("@"), name = record[0].slice(0, split), version = record[0].slice(split + 1);
    if (version.startsWith("workspace:")) {
      const path = version.slice("workspace:".length), workspace = lock.workspaces[path];
      if (!workspace || workspace.name !== name) throw Error(`Unresolved workspace: ${id}`);
      const instance = { id, name, version, integrity: "workspace", record, edges: [] as Edge[] };
      instances.set(id, instance);
      instance.edges = edges(id, workspace as NonNullable<PackageRecord[2]>);
      return;
    }
    if (!name || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) || !/^sha(?:256|512)-[A-Za-z0-9+/]+=*$/.test(record[3] ?? "")) throw Error(`Unpinned registry instance: ${id}`);
    const instance = { id, name, version, integrity: record[3]!, record, edges: [] as Edge[] };
    instances.set(id, instance);
    const metadata = record[2] ?? {};
    // BullMQ 6 probes this optional adapter without declaring it in its manifest.
    // Its absence is an edge too: installing it anywhere reachable changes identity.
    instance.edges = edges(id, name === "bullmq" ? { ...metadata,
      peerDependencies: { ...metadata.peerDependencies, "@valkey/valkey-glide": "*" },
      optionalPeers: [...metadata.optionalPeers ?? [], "@valkey/valkey-glide"] } : metadata);
  }
  const entries = Object.entries(roots).sort(([a], [b]) => a.localeCompare(b)).map(([name, dependencies]) => ({ name, edges: edges(name, { dependencies }) }));
  const packages = [...instances.values()].sort((a, b) => a.id.localeCompare(b.id));
  const names = new Set(packages.map(p => p.name));
  const overrides = Object.fromEntries(Object.entries(lock.overrides ?? {}).filter(([name]) => names.has(name)).sort());
  // Physical hoist paths resolve edges, but do not describe executable semantics.
  // Stable traversal preserves distinct instances, cycles and singleton sharing.
  const ids = new Map<string, string>(), graph: Instance[] = [];
  function reference(target: string | null): string | null {
    if (target === null) return null;
    const known = ids.get(target);
    if (known) return known;
    const instance = instances.get(target)!;
    const id = `${instance.name}@${instance.version}:${ids.size}`;
    ids.set(target, id);
    const node = { ...instance, id, edges: [] as Edge[] };
    graph.push(node);
    node.edges = instance.edges.map(edge => ({ ...edge, target: reference(edge.target) }));
    return id;
  }
  const normalized = entries.map(root => ({ ...root, edges: root.edges.map(edge => ({ ...edge, target: reference(edge.target) })) }));
  return { lockfileVersion: lock.lockfileVersion, configVersion: lock.configVersion, roots: normalized, packages: graph, overrides };
}

export function requireWorkspace(lock: Lock, path: string, manifest: Manifest) {
  const workspace = lock.workspaces[path];
  if (!workspace || workspace.name !== manifest.name) throw Error(`Workspace missing from lock: ${path}`);
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (digest(workspace[field] ?? {}) !== digest(manifest[field] ?? {})) throw Error(`Stale lock workspace: ${path}/${field}`);
  }
}
