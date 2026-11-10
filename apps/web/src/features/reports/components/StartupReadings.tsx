import type { StartupMetrics, StartupLayer, StartupEvent } from "@infraforge/contracts/telemetry";

const value = (v: string | number | boolean | null | undefined) => v == null ? "Unknown" : typeof v === "boolean" ? v ? "Yes" : "No" : typeof v === "number" ? v.toLocaleString() : v;
function Readings({rows}: {rows: ReadonlyArray<readonly [string, string | number | boolean | null | undefined]>}) {
  return <dl className="mt-2 grid gap-2 sm:grid-cols-2">{rows.map(([label, v]) => <div key={label}><dt>{label}</dt><dd className="if-num break-all">{value(v)}</dd></div>)}</dl>;
}
function Layers({title, rows, omitted, digestLabel, bytesLabel}: {title: string; rows?: StartupLayer[] | null; omitted?: number | null; digestLabel: string; bytesLabel: string}) {
  return <div className="mt-3"><h5 className="font-medium">{title}</h5>{rows == null ? <Readings rows={[[digestLabel, null], [bytesLabel, null]]} /> : rows.length ? <ul>{rows.map((r, i) => <li className="break-all" key={`${r.digest}-${i}`}><Readings rows={[[digestLabel, r.digest], [bytesLabel, r.bytes]]} /></li>)}</ul> : <p>No rows retained.</p>}<p>Layer rows omitted: {value(omitted)}</p></div>;
}
function Events({rows, omitted}: {rows?: StartupEvent[] | null; omitted?: number | null}) {
  return <div className="mt-3"><h5 className="font-medium">Startup events (bounded)</h5>{rows == null ? <p>Unknown</p> : rows.length ? <ul>{rows.map((e, i) => <li className="break-all" key={i}>{value(e.at)} us / {e.id} / {e.kind}: {e.detail}</li>)}</ul> : <p>No events retained.</p>}<p>Startup events omitted: {value(omitted)}</p></div>;
}

export function StartupReadings({id, metrics: m}: {id: string; metrics?: StartupMetrics}) {
  return <section aria-label={`Startup measurements for ${id}`} className="mt-4">
    <h3 className="font-semibold">{id}: artifact acquisition and startup</h3>
    <p className="mt-2 text-sm text-ink-3">Counters accumulate from run start through this sample. Inventories and LB health describe this instant. Artifact-ready means required layers were acquired. Listener-ready opens the process gate after startup; LB health observations remain separate. Neither timestamp proves first traffic or continuous health.</p>
    <Readings rows={[["Startup sample time (us)", m?.sampledAtUs], ["Registry owners omitted", m?.omittedRegistries], ["Artifact clients omitted", m?.omittedClients], ["Startup controllers omitted", m?.omittedControllers]]} />
    <h4 className="mt-3 font-medium">Registry owners</h4>
    {m?.registries == null ? <p>Unknown</p> : m.registries.length ? m.registries.map(r => <div key={r.id} className="mt-3">
      <h5 className="break-all font-medium">{r.id}</h5>
      <Readings rows={[["Registry uploads (cumulative)", r.uploads], ["Registry deduplicated uploads (cumulative)", r.deduplicated],
        ["Registry manifest writes (cumulative)", r.manifestWrites], ["Registry tag writes (cumulative)", r.tagWrites],
        ["Registry manifest reads (cumulative)", r.manifestReads], ["Registry blob reads (cumulative)", r.blobReads],
        ["Registry response body bytes (cumulative)", r.generatedResponseBodyBytes], ["Registry blob bytes (current)", r.blobBytes],
        ["Registry blob rows omitted", r.omittedBlobs], ["Registry manifest rows omitted", r.omittedManifests], ["Registry tag rows omitted", r.omittedTags]]} />
      <Layers title="Registry blobs (digest and bytes)" rows={r.blobs} omitted={r.omittedBlobs} digestLabel="Registry blob digest" bytesLabel="Registry blob bytes" />
      <h5 className="mt-3 font-medium">Registry manifests</h5>
      {r.manifests == null ? <p>Unknown</p> : r.manifests.length ? r.manifests.map(manifest => <div key={manifest.digest} className="break-all">
        <p>Manifest digest: {manifest.digest}; manifest bytes: {value(manifest.bytes)}</p>
        <Layers title="Manifest layers (digest and bytes)" rows={manifest.layers} omitted={manifest.omittedLayers} digestLabel="Manifest layer digest" bytesLabel="Manifest layer bytes" />
      </div>) : <p>No manifests retained.</p>}
      <h5 className="mt-3 font-medium">Registry tags</h5>
      {r.tags == null ? <p>Unknown</p> : r.tags.length ? <ul>{r.tags.map(t => <li className="break-all" key={t.tag}>{t.tag}: {t.digest}</li>)}</ul> : <p>No tags retained.</p>}
    </div>) : <p>No registry owners retained.</p>}
    <h4 className="mt-3 font-medium">Artifact clients</h4>
    {m?.clients == null ? <p>Unknown</p> : m.clients.length ? m.clients.map(c => <div key={c.id} className="mt-3">
      <h5 className="break-all font-medium">{c.id}</h5>
      <Readings rows={[["Artifact pulled bytes (cumulative)", c.pulledBytes], ["Artifact reused layers (cumulative)", c.reusedLayers],
        ["Artifact failures (cumulative)", c.failures], ["Artifact cached bytes (current)", c.cachedBytes], ["Artifact cache rows omitted", c.omittedCache], ["Artifact replica rows omitted", c.omittedReplicas]]} />
      <Layers title="Artifact cached layers (digest and bytes)" rows={c.cache} omitted={c.omittedCache} digestLabel="Artifact cached layer digest" bytesLabel="Artifact cached layer bytes" />
      {c.replicas == null ? <p>Artifact replica records: Unknown</p> : c.replicas.length ? c.replicas.map(r => <div key={r.id} className="mt-3">
        <h5 className="break-all font-medium">Artifact replica: {r.id}</h5>
        <Readings rows={[["Artifact target", r.target], ["Image reference", r.reference], ["Resolved image digest", r.resolvedDigest],
          ["Artifact state", r.state], ["Artifact attempts (cumulative)", r.attempts], ["Artifact-ready time (us)", r.artifactReadyAtUs]]} />
        <Layers title="Required image layers (digest and bytes)" rows={r.requiredLayers} omitted={r.omittedLayers} digestLabel="Required image layer digest" bytesLabel="Required image layer bytes" />
      </div>) : <p>No artifact replica records retained.</p>}
      <Events rows={c.events} omitted={c.omittedEvents} />
    </div>) : <p>No artifact clients retained.</p>}
    <h4 className="mt-3 font-medium">Startup controllers</h4>
    {m?.controllers == null ? <p>Unknown</p> : m.controllers.length ? m.controllers.map(c => <div key={c.id} className="mt-3">
      <h5 className="break-all font-medium">{c.id}</h5>
      <Readings rows={[...(c.signal ? [["Scaling signal source", c.signal.source], ["Scaling signal monitoring backend", c.signal.backend], ["Scaling signal freshness bound (us)", c.signal.freshForUs]] as const : []), ["Desired replicas (current)", c.desired], ["LB-eligible replicas (current)", c.inService],
        ["Controller evaluations (cumulative)", c.evaluations], ["Controller missing measurements (cumulative)", c.missingMeasurements],
        ["Controller identity budget exhausted (cumulative)", c.identityBudgetExhausted], ["Controller replica rows omitted", c.omittedReplicas]]} />
      {c.replicas == null ? <p>Controller replica records: Unknown</p> : c.replicas.length ? c.replicas.map(r => <div key={r.id} className="mt-3">
        <h5 className="break-all font-medium">Controller replica: {r.id}</h5>
        <Readings rows={[["Replica slot ordinal", r.ordinal], ["Replica lifecycle state", r.state], ["Replica created time (us)", r.createdAtUs],
          ["Listener-ready time (us)", r.listenerReadyAtUs], ["Controller artifact attempts (cumulative)", r.attempts],
          ["Replica endpoint alive (current)", r.endpointAlive], ["Replica endpoint ready (current)", r.endpointReady],
          ["Replica LB healthy (current)", r.lbHealthy], ["Replica LB draining (current)", r.lbDraining]]} />
      </div>) : <p>No controller replica records retained.</p>}
      <Events rows={c.events} omitted={c.omittedEvents} />
    </div>) : <p>No startup controllers retained.</p>}
    <p className="mt-2 text-sm text-ink-3">Each list retains at most 100 rows. Omitted identities, absent historical fields, replica generation and exact first LB-eligible time are Unknown. Initially deployed replicas can have listener-ready time zero without an observed pull. Registry response bytes are generated bodies, not guaranteed delivery; pulled bytes count client-validated blob replies, and reused layers count cache matches, not bytes saved. Authored digest identities do not prove byte hashing, full OCI conformance, provider startup speed or availability.</p>
  </section>;
}
