/* The three marks every timetable uses, introduced before anyone needs them. */
export function EvidenceMarks() {
  return (
    <section aria-labelledby="marks-title" className="border-t border-line">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <div>
          <h2 id="marks-title" className="if-display text-[36px] sm:text-[48px]">It only draws what it recorded.</h2>
          <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-ink-2">
            A model you can trust has to say where its knowledge stops. InfraForge keeps three kinds of mark apart, on every screen.
          </p>
        </div>
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-3">
          <li className="bg-bg p-6">
            <svg viewBox="0 0 160 40" className="h-10 w-full" aria-hidden="true">
              <line x1="0" y1="20" x2="70" y2="20" stroke="var(--if-ink-3)" strokeWidth="1.5" />
              <line x1="70" y1="20" x2="110" y2="20" stroke="var(--if-warn)" strokeWidth="3" />
              <line x1="110" y1="20" x2="160" y2="20" stroke="var(--if-hot)" strokeWidth="5" />
            </svg>
            <h3 className="mt-4 text-[17px] font-semibold text-ink">Recorded</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">A solid rail is a measured fact at that modeled second. It thickens as health gets worse, so it reads without colour.</p>
          </li>
          <li className="bg-bg p-6">
            <div aria-hidden="true" className="if-hatch h-10 w-full border-y border-line" />
            <h3 className="mt-4 text-[17px] font-semibold text-ink">Not recorded</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">Hatching is time the simulator did not keep. It is Unknown: never a zero, never a guess drawn between two points.</p>
          </li>
          <li className="bg-bg p-6">
            <svg viewBox="0 0 160 40" className="h-10 w-full" aria-hidden="true">
              <line x1="0" y1="20" x2="160" y2="20" stroke="var(--if-line-strong)" strokeWidth="1" />
              <rect x="74" y="14" width="12" height="12" transform="rotate(45 80 20)" fill="var(--if-bg)" stroke="var(--if-accent)" strokeWidth="2" />
            </svg>
            <h3 className="mt-4 text-[17px] font-semibold text-ink">Yours</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">Chalk blue is the learner: your predictions and your actions. It sits beside the record and never replaces it.</p>
          </li>
        </ul>
      </div>
    </section>
  );
}
