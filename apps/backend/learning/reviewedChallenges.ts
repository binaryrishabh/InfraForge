/** Human-reviewed challenge identity for each published executable contentVersion.
 * Keep old records. A changed challenge needs a new reviewed contentVersion. */
export interface LearningChallengeReview { challengeId: string; version: number; hash: string }
export const REVIEWED_CHALLENGES: Readonly<Record<string, LearningChallengeReview>> = {
  "route-around-a-slow-vm@1": { challengeId: "route-around-a-slow-vm", version: 1, hash: "96465260711b0f1ac74f1d62c606146c356721bde0b3843e0423d11b022a3f52" },
  "leave-room-for-a-burst@1": { challengeId: "leave-room-for-a-burst", version: 1, hash: "f7cbf5006543fbbe1739e32bc9f25d2a1761d7ef9227dbdf11afbe5a9e42f9e2" },
  "retrying-a-full-pool@1": { challengeId: "retrying-a-full-pool", version: 1, hash: "5d8317a0a3d135a19466ec5e1da5b86e7d46bd6a4ffaebbaadaec4bf443ca49c" },
  "move-reads-off-the-writer@1": { challengeId: "move-reads-off-the-writer", version: 1, hash: "c2e20370cf5c8314c1906e2d80396a6b4cbb7f819be2368f8eb5472525412d1a" },
  "budget-app-database-sessions@1": { challengeId: "budget-app-database-sessions", version: 1, hash: "8597b0eee650f2bd13dfe1da9ce88c3c1289b6048762925e167cd8ff5f9ac17a" },
  "replicas-do-not-take-writes@1": { challengeId: "replicas-do-not-take-writes", version: 1, hash: "0727ed317ec1c9a39550330440641dc35cf9f8b9273a32d5cdf56f2cd8e1b213" },
  "keep-up-with-the-queue@1": { challengeId: "keep-up-with-the-queue", version: 1, hash: "80c57013d6a2e71fa6f89b77ba17a61ac682995aa376fada131d88cdcca96627" },
  "leave-time-to-acknowledge@1": { challengeId: "leave-time-to-acknowledge", version: 1, hash: "545ede03623d81e9654e578a9ce2406689f162bce5543af7ddc84cd0701888e7" },
  "open-one-subscriber@1": { challengeId: "open-one-subscriber", version: 1, hash: "bc2e0e6372b2bde7615fc4daa6b1f7a3c780bbf2b53a57c70d359945a69ba247" },
  "find-the-denying-rule@1": { challengeId: "find-the-denying-rule", version: 1, hash: "e002c76a7884c02b542cad296516b26d3c5eaceaa1f9991adaf490c8b690d7b3" },
  "leave-room-for-firewall-flows@1": { challengeId: "leave-room-for-firewall-flows", version: 1, hash: "492dca0578609884ed0729140e110de02cfd689831faecaa172f43eca803c705" },
  "choose-a-retry-mitigation@1": { challengeId: "choose-a-retry-mitigation", version: 1, hash: "6ca83f5bd42df0ea1f6ad09bb15d139a7b3b15abb3083a93b0e4d7e8b65ef46e" },
  "catalogue-link-flash@1": { challengeId: "catalogue-link-flash", version: 1, hash: "2d6afe745f45e31593096d34ae669138f45f2d6dadc2eff02295a71114ca7a6e" },
  "flash-sale-order-backlog@1": { challengeId: "flash-sale-order-backlog", version: 1, hash: "c84cc970bee937a37136dd716a85724ee589fd8706b82fbd709e64de825b4093" },
  "where-does-the-time-go@1": { challengeId: "where-does-the-time-go", version: 1, hash: "58174698cfd975ad0117a8cf029a13293c720115455140058090c0de9814b5e9" },
  "waiting-with-spare-cpu@1": { challengeId: "waiting-with-spare-cpu", version: 1, hash: "e4fec65bcf80c96d30f239f2c7d6d4d8e3bc9427220c0bf5b40d6c47e8777f37" },
  "one-bigger-or-two-smaller@1": { challengeId: "one-bigger-or-two-smaller", version: 1, hash: "48b7361f4daf5649bf8ea465c307df7b5567bf32254743206e8a6cd80da13a56" },
  "protect-one-api-route@1": { challengeId: "protect-one-api-route", version: 1, hash: "695b5f64876c96ff10cc0f6f37a9f74190b41a9378d92c0cc75a163ca7a509ea" },
  "queue-overlapping-jobs@1": { challengeId: "queue-overlapping-jobs", version: 1, hash: "ff340d09b24bff1c2f824e408ae3025f8bd39b7b6cec7cc9917fbcafaf6405cc" },
  "bound-function-pool-pressure@1": { challengeId: "bound-function-pool-pressure", version: 1, hash: "b58e0c704222b88d8e5d83d99dc998624c8b70f322e82d115ebd33767cd71d50" },
  "diagnose-lost-app-capacity@1": { challengeId: "diagnose-lost-app-capacity", version: 1, hash: "c96034e934dbd75035b519f13035467cdae6eb9d8f08b921c06ad18cdb2466f2" },
  "investigate-a-pool-reset@1": { challengeId: "investigate-a-pool-reset", version: 1, hash: "ed61ae0627f3d15dcab41899f5cc80c5c54edf207c3068bdc9abe765e590500e" },
  "budget-for-a-partition@1": { challengeId: "budget-for-a-partition", version: 1, hash: "7b35c54cc84b3f4bc7af1e315fe55ed29b400b4395dca7fcce17a071b5e0d960" },
  "trace-a-saturation-cascade@1": { challengeId: "trace-a-saturation-cascade", version: 1, hash: "b8b8a24164dfdc70aadc52aac2b4eb75c1bb8f3e6730d7206c400de777b29f64" },
};
