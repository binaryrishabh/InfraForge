import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { starter } from "../../starter";
import { MODEL_NOTE } from "../modelNote";

export const cacheAnEmptyAnswerV1: ChallengeDefinition = {
  engine:"2",id:"cache-an-empty-answer",version:1,title:"Cache an empty answer",difficulty:"core",
  summary:"Reuse successful empty lookups so repeated requests for absent rows do not keep querying the database.",
  concepts:["Negative caching","Cache penetration","Absence versus failure"],
  story:["A lookup service uses a fixed dataset of 100 keys. Only 20 have rows; the other 80 are valid queries with successful empty results. There are no inserts or writes in this exercise.",
    "Ordinary cached rows live for 60 seconds, the working set fits and Single-flight is already on. Yet the database keeps executing queries for keys it has already found absent, and the app fails callers under this load."],
  objective:"Through second 12, complete at least 19000 callers with at most 100 unsuccessful. Record at most one successful empty source query per ten successful absent answers. Keep the dataset and workload unchanged.",
  workload:{targetThroughput:108000,throughputUnit:"per-minute",trafficShape:"steady",peakMultiplier:1,readWriteRatio:1,payloadSize:"light",workloadDynamics:{version:1,arrivalProcess:"poisson",applicationCpuCv:0}},
  workloadNote:"1800 read-only lookups/s on average, seeded Poisson arrivals, uniform selection among 100 keys, 80 initially absent. Pending callers remain separate.",
  evaluationSeconds:12,evaluationNote:"Cumulative caller and cache-helper counters through second 12. Empty source queries and successful absent answers differ when misses coalesce. No whole-run latency SLO is scored.",
  criteria:[{id:"checks",kind:"deployment-checks",label:"Complete deployment checks"},
    {id:"callers",kind:"caller-outcomes",label:"Complete 19000 callers with at most 100 unsuccessful",minCompleted:19000,maxUnsuccessful:100},
    {id:"absence-load",kind:"cache-negative-load",label:"At most 0.1 empty source queries per successful absent answer",resourceId:"cache",maxSourceReadsPerAnswer:0.1}],
  predictions:[{id:"health",kind:"overall-health",prompt:"What overall health will the starter record at second 12?"}],
  hints:["Compare successful absent answers with empty source queries, then inspect database CPU and whole-run failed callers. An empty result is different from a cache miss or a failed query.",
    "Single-flight shares concurrent fills. Once an empty query finishes, the next lookup still needs a source query unless the empty answer itself is retained. A longer ordinary TTL only helps stored row bodies.",
    "Select cache and change only Negative cache TTL from zero to a positive lifetime. Keep ordinary TTL, capacity, dataset and workload unchanged, and check the one-change review."],
  debrief:["An absence entry records a successful empty query result. Later reads of that key reuse it until its own lifetime ends. A timeout, unavailable database or missing reply body never proves absence and is never stored as such.",
    "Raising ordinary TTL is the near miss: it cannot extend an absence entry that was never created. A bigger database can relieve caller pressure, but still executes repeated empty queries. The source-work requirement measures that work separately from caller completion.",
    "Positive negative-cache lifetimes shorter than the reference may also meet the budget; the lab does not require a particular value. Coalescing can reduce source work too, but is already enabled. Altering the dataset or popularity changes the question and must be disclosed.",
    "This is a static read-only dataset. It does not model a newly inserted row becoming visible through a cached absence, insertion invalidation, arbitrary user IDs, a Bloom filter or distributed cache coherence. Empty answers are successful modeled queries, not HTTP status codes or provider timings.",MODEL_NOTE],
  starter:starter([["app","Virtual Machine",0,0,{skuId:"m5.2xlarge"}],
    ["cache","Cache",1,0,{cachePolicy:{version:2,capacityEntries:256,ttlSeconds:60,singleFlight:true,negativeTtlSeconds:0}}],
    ["db","Database",1,1,{size:"small",dataKeyspace:{version:1,count:100,absentCount:80,accessPattern:"uniform"}}]],[["app","cache"],["app","db"]]),
};
