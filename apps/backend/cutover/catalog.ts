import { digest, type Database } from "./database";

// Names and definition hashes are safe evidence. Never emit function bodies,
// defaults, policy expressions or view SQL: these may contain private literals.
const queries: Record<string, string> = {
  relation: `SELECT c.relname AS name, jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'replicaIdentity',c.relreplident,
    'partition',pg_get_partkeydef(c.oid)) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`,
  // Dumps omit dropped attribute slots. Compare visible column order, which a
  // restore preserves, rather than physical storage positions that it rebuilds.
  column: `SELECT c.relname||'.'||a.attname AS name, jsonb_build_object('position',row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum),
    'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,
    'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'collation',co.collname) AS definition
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    LEFT JOIN pg_collation co ON co.oid=a.attcollation
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped`,
  constraint: `SELECT c.relname||'.'||k.conname AS name, jsonb_build_object('sql',pg_get_constraintdef(k.oid),
    'validated',k.convalidated,'enforced',k.conenforced,'deferrable',k.condeferrable,'deferred',k.condeferred) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
  index: `SELECT c.relname AS name, jsonb_build_object('sql',pg_get_indexdef(c.oid),'valid',i.indisvalid,
    'ready',i.indisready,'live',i.indislive) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
  trigger: `SELECT c.relname||'.'||t.tgname AS name, jsonb_build_object('sql',pg_get_triggerdef(t.oid),
    'enabled',t.tgenabled) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`,
  function: `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,
    pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p')`,
  policy: `SELECT c.relname||'.'||p.polname AS name, jsonb_build_object('command',p.polcmd,
    'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(r.rolname ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) AS definition
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
  view: `SELECT c.relname AS name, pg_get_viewdef(c.oid) AS definition FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')`,
  extension: `SELECT e.extname AS name,jsonb_build_object('version',e.extversion,'schema',n.nspname) AS definition
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace`,
  schema: `SELECT nspname AS name,nspname AS definition FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'`,
};

export type Catalog = Record<string, string>;
export async function schemaCatalog(db: Database): Promise<Catalog> {
  const entries: Array<[string, string]> = [];
  for (const [kind, sql] of Object.entries(queries)) {
    for (const row of (await db.query(sql)).rows) {
      const name = /^[\w.(), "\[\]]+$/.test(row.name) ? row.name : `[name:${digest(row.name)}]`;
      entries.push([`${kind}:${name}`, digest(JSON.stringify(row.definition).replace(/\r\n/g, "\n"))]);
    }
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function catalogDifferences(expected: Catalog, actual: Catalog) {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    .filter((key) => expected[key] !== actual[key]).map((object) => ({ object,
      change: !expected[object] ? "unexpected" : !actual[object] ? "missing" : "definition differs" }));
}
