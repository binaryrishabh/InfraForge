const STEPS = [
  ["Read the brief", "Each challenge sets a fixed workload, an evaluation second and a short list of requirements."],
  ["Build", "Place DNS, load balancers, app servers, caches and databases on the canvas and wire them up."],
  ["Predict", "Before anything runs, commit to what you expect: overall health, the busiest resource, whether the autoscaler steps in."],
  ["Run", "The simulator applies fixed rules to your design and stops exactly at the evaluation second."],
  ["Understand", "Each requirement and each prediction is checked against recorded evidence, side by side."],
  ["Improve", "Change one thing, run again under the same workload and seed, and compare the two runs."],
];

export function LoopSection() {
  return (
    <section aria-labelledby="loop-title" className="border-t border-line bg-surface">
      <div className="mx-auto max-w-[1160px] px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div>
            <p className="if-eyebrow">The loop</p>
            <h2 id="loop-title" className="if-title mt-3 text-[32px]">Learning happens in the gap between what you expected and what ran.</h2>
          </div>
          <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(([title, body], index) => (
              <li key={title} className="bg-raised p-5">
                <p className="if-num text-sm text-ink-3">{String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-2 text-[17px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
