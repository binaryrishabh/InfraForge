const STOPS = [
  ["Read the brief", "A fixed workload, a second it is judged at, a short list of requirements. Resilience challenges also name the part that will break, and when."],
  ["Build", "Place load balancers, app servers, caches and databases and connect them. The map is the same one you will watch run."],
  ["Predict", "Before anything runs, lock what you expect. Your answer is kept beside the result and never changes it."],
  ["Run", "The simulator advances one modeled second at a time and stops exactly at the judged second."],
  ["Read", "Move through the recorded run second by second. What was not recorded is marked, never filled in."],
  ["Change one thing", "Write down your reason, change the design, and run the same experiment again to compare."],
];

/* The learning loop drawn as one line: the last stop leads back to the first. */
export function LoopLine() {
  return (
    <section aria-labelledby="loop-title" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-6 lg:px-8">
        <h2 id="loop-title" className="if-display max-w-[20ch] text-[36px] sm:text-[48px]">Learning happens in the gap between what you expected and what ran.</h2>
        <ol className="relative mt-14 grid gap-8 md:grid-cols-6 md:gap-6">
          <li aria-hidden="true" className="absolute bottom-0 left-[6px] top-0 w-px bg-line-strong md:inset-x-0 md:bottom-auto md:top-[6px] md:h-px md:w-auto" />
          {STOPS.map(([title, body], i) => (
            <li key={title} className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-4 md:block">
              <span aria-hidden="true" className={i === 2 ? "relative mt-[3px] block size-[13px] rotate-45 border-2 border-accent bg-bg md:mt-0" : "relative mt-[3px] block size-[13px] border-2 border-ink bg-bg md:mt-0"} />
              <div className="md:mt-5">
                <p className="if-num text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-1 text-[17px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
