These are deliberately fake private-scoring bundles for tests. They use burned,
public version 1 teaching recordings with fake workload identities and rubric
versions. Their commitments are calculated only by `tests/scoringFixtures.ts`.
They cannot satisfy the commitments in the production version 2 definitions.

No production private bundle belongs in this directory. Tests and CI must work
without `INFRAFORGE_SCORING_DIRECTORY` or access to the owner's private store.
The backend image and runtime import closure exclude this directory.
