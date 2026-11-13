import type { LearningLesson } from "@infraforge/contracts/learning";

export const refreshAfterAWrite: LearningLesson = {
  id: "refresh-after-a-write", contentVersion: 1, trackId: "data", moduleId: "cache-freshness",
  title: "Refresh after a write", kind: "executable-lab", level: "intermediate", availability: "available",
  summary: "Tell a healthy cache from a fresh one: with invalidation off, a cache keeps handing back rows that were already updated.",
  prerequisites: ["cache-hits-and-misses", "reuse-before-expiry", "fit-the-working-set"],
  problem: ["A catalogue service reads and updates 50 rows through a cache whose entries live for 30 seconds. The app, the cache and the database all look healthy, yet most cache hits return a row that was already updated."],
  explanation: [
    "Predict overall health, run unchanged and read the cache's hits beside the hits that were behind the database. Health says nothing about which version a hit returned, so a Healthy run can still serve old rows.",
    "Record a diagnosis: with Invalidate on write off, a committed write leaves the old row in the cache until its lifetime ends. Select cache and turn Invalidate on write back on. Keep the TTL, capacity, topology and workload unchanged. The design review must count one change. Run again: each write removes its row, the next read refills the new version, and the hits behind the database fall to zero here. A hit that landed in the gap between a commit and its invalidation would still be counted, but none did. Hits fall and database fetches rise, because every write forces a refill.",
    "As a near miss, restore the starter and cut only the TTL. Rows change more often than once a second here, so a shorter lifetime still leaves a large share of hits behind the database while adding database fetches. A bigger database, a bigger app or a longer TTL leave the counts where they were.",
    "Valid alternatives exist. With invalidation on, the TTL no longer decides freshness, so a shorter or longer one also meets the requirement. A cache so small that it rarely hits also avoids old rows, which is why the requirement asks for a minimum number of hits. And for rows that rarely change, or data where an old answer is safe, a short TTL alone can be the right trade."],
  experiment: {challengeId: "refresh-after-a-write", prediction: "What overall health will the starter record at second 30? Only the health choice is scored; explain whether Healthy means callers got current rows.",
    evidenceToInspect: ["Cache: Hits", "Cache: Misses", "Cache: Hits behind the database", "Cache: Most versions behind", "Application helper: Database fetches", "Whole run: Failed"]},
  limitations: [
    "Results are educational model outputs with an authored workload, row count and lifetime, not provider benchmarks. Writes that invalidate make the cache work harder, with more misses and more database fetches; whether that is worth freshness depends on how often rows change and how bad an old answer is.",
    "A hit counts as behind the database when the cached row's version is older than the version the modeled database had committed at that moment. That is version lag, not application correctness, and it shows nothing about read-your-writes for one caller. Each request touches one row.",
    "Invalidation here is a delete after the write commits, on one cache. A hit that lands in the brief gap between the commit and the delete would count as behind (none did in this lab), and invalidation across several cache nodes is not modeled.",
    "The comparison needs one database without replication or read routing: a cache with this setting saved is refused before the run when its database has either, with a message, rather than measured against a guess."],
  check: null,
  followUp: "Cite the starter, the invalidation run and the TTL near miss. Explain why cutting the TTL could not meet the requirement here, what invalidation cost in database reads, and when a short TTL alone is enough. Then compare reuse-before-expiry, where a longer TTL was the fix.",
};
