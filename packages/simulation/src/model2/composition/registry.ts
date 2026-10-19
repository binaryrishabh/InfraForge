export interface ModuleManifest {
  id: string;
  revision: string;
  hostApi: "composition-host/1";
  port: "identified-request/1";
}
export interface ResourceModule<C, H, I> {
  manifest: ModuleManifest;
  validate(config: C): void;
  instantiate(config: C, host: H): I;
}

// Trusted, statically imported modules. No dynamic loading or resource-kind
// dispatch belongs in the event kernel. A registry is local to one composition.
export class ModuleRegistry<C extends { id: string; kind: string }, H, I> {
  private modules = new Map<string, ResourceModule<C, H, I>>();
  register<K extends C["kind"]>(kind: K, module: ResourceModule<Extract<C, { kind: K }>, H, I>) {
    if (this.modules.has(kind) || [...this.modules.values()].some(m => m.manifest.id === module.manifest.id)) throw Error("Duplicate module owner");
    if (!module.manifest.id || !module.manifest.revision || module.manifest.hostApi !== "composition-host/1" || module.manifest.port !== "identified-request/1") throw Error("Unsupported module contract");
    // The only type erasure is guarded by the exact discriminant lookup below.
    this.modules.set(kind, {
      manifest: { ...module.manifest },
      validate: config => module.validate(config as Extract<C, { kind: K }>),
      instantiate: (config, host) => module.instantiate(config as Extract<C, { kind: K }>, host),
    });
    return this;
  }
  has(kind: string) { return this.modules.has(kind); }
  create(config: C, host: H): I {
    const module = this.modules.get(config.kind);
    if (!module) throw Error(`Unsupported resource module: ${config.kind}`);
    module.validate(config);
    return module.instantiate(config, host);
  }
  lock() { return [...this.modules.values()].map(m => ({ ...m.manifest })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
}

export const manifest = (id: string, revision: string): ModuleManifest => ({ id, revision, hostApi: "composition-host/1", port: "identified-request/1" });
