import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataDeliveryReadings } from "../src/features/live/DataDeliveryReadings";

const base = { version: 1 as const, serving: 1, waiting: 0, queued: 0, rejected: 0, sessionRefused: 0, "query-queue-full": null };
const html = (database: Record<string, unknown>) => renderToStaticMarkup(<DataDeliveryReadings type="Database" metrics={{ database: { ...base, ...database } } as never} />);

test("row-lock rows appear only when the saved row lock order recorded them; zero is shown and null stays Unknown", () => {
  const unmarked = html({});
  for (const label of ["Deadlocks detected", "Row-lock waits", "Transactions ended as deadlock victims"]) expect(unmarked).not.toContain(label);
  const marked = html({ deadlocks: 0, lockWaits: 12, deadlockVictims: 0 });
  expect(marked).toContain("<dt>Deadlocks detected</dt><dd>0</dd>"); expect(marked).toContain("<dt>Row-lock waits</dt><dd>12</dd>"); expect(marked).toContain("<dt>Transactions ended as deadlock victims</dt><dd>0</dd>");
  const unknown = html({ deadlocks: null, lockWaits: null, deadlockVictims: null });
  expect(unknown).toContain("<dt>Deadlocks detected</dt><dd>Unknown</dd>");
  expect(renderToStaticMarkup(<DataDeliveryReadings type="Cache" metrics={{ cache: { version: 1, hits: 1, misses: 1, expirations: 0, evictions: 0, coalescedWaiters: 0 } } as never} />)).not.toContain("Deadlocks detected");
});
