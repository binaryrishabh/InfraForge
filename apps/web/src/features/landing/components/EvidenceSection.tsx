const COLUMNS = [
  { title: "Observed", note: "recorded facts", items: ["Overall health at second 150 was saturated.", "db reached 100% CPU.", "The security scan reported no issues."] },
  { title: "Interpreted", note: "derived from recorded evidence", items: ["db had at most 10 points of CPU headroom at the final capture. This does not establish how long it stayed there."] },
  { title: "Unknown", note: "evidence limits", items: ["Continuous telemetry is not retained.", "One run establishes no statistical significance."] },
];

export function EvidenceSection() {
  return (
    <section aria-labelledby="evidence-title" className="border-t border-line">
      <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-6 lg:px-8">
        <p className="if-eyebrow">Reports</p>
        <h2 id="evidence-title" className="if-title mt-3 max-w-[30ch] text-[32px]">Every report says what is known, what is inferred and what is not.</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {COLUMNS.map((column) => (
            <div key={column.title} className="border-t-2 border-ink pt-4">
              <h3 className="text-[17px] font-semibold">{column.title} <span className="font-normal text-ink-3">— {column.note}</span></h3>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-2">
                {column.items.map((item) => <li key={item} className="border-l border-line pl-3">{item}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
