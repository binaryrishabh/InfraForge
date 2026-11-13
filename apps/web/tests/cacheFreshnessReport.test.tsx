import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CacheReadings } from "../src/features/reports/components/CacheReadings";

const base = { version: 1 as const, hits: 10, misses: 2, expirations: 0, evictions: 0, coalescedWaiters: null };
const html = (cache: Record<string, unknown>) => renderToStaticMarkup(<CacheReadings resource={{ id: "cache", cache: { ...base, ...cache } } as never} cache />);

test("freshness rows appear only when the report recorded them, and a null reading stays Unknown", () => {
  const unmarked = html({});
  expect(unmarked).not.toContain("Cache: Hits behind the database"); expect(unmarked).not.toContain("Cache: Most versions behind");
  const marked = html({ outdatedHits: 7, maxVersionsBehind: 3 });
  expect(marked).toContain("<dt>Cache: Hits behind the database</dt><dd>7</dd>"); expect(marked).toContain("<dt>Cache: Most versions behind</dt><dd>3</dd>");
  const none = html({ outdatedHits: 0, maxVersionsBehind: 0 });
  expect(none).toContain("<dt>Cache: Hits behind the database</dt><dd>0</dd>"); expect(none).toContain("<dt>Cache: Most versions behind</dt><dd>0</dd>");
  expect(html({ outdatedHits: null, maxVersionsBehind: null })).toContain("<dt>Cache: Hits behind the database</dt><dd>Unknown</dd>");
  expect(html({ staleServed: 4, maxStaleAgeUs: 10 })).not.toContain("Hits behind the database"); // each conditional pair is gated by its own evidence
});
