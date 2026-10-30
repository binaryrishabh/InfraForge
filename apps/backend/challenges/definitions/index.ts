import type { ChallengeDefinition } from "@infraforge/contracts/challenges";
import { firstProductionApiV1 } from "./first-production-api/v1";
import { secureTheEdgeV1 } from "./secure-the-edge/v1";
import { cacheMattersV1 } from "./cache-matters/v1";
import { writeHeavyV1 } from "./write-heavy/v1";
import { scaleOutSafelyV1 } from "./scale-out-safely/v1";
import { peakTrafficV1 } from "./peak-traffic/v1";
import { loseAnAppServerV1 } from "./lose-an-app-server/v1";
import { cacheFailureV1 } from "./cache-failure/v1";
import { headroomUnderCpuPressureV1 } from "./headroom-under-cpu-pressure/v1";
import { afterTheCacheReturnsV2 } from "./after-the-cache-returns/v2";
import { afterTheCacheReturnsV1 } from "./after-the-cache-returns/v1";
import { loseAnAppServerV2 } from "./lose-an-app-server/v2";
import { firstProductionApiV2 } from "./first-production-api/v2";
import { secureTheEdgeV2 } from "./secure-the-edge/v2";
import { cacheMattersV2 } from "./cache-matters/v2";
import { writeHeavyV2 } from "./write-heavy/v2";
import { scaleOutSafelyV2 } from "./scale-out-safely/v2";
import { peakTrafficV2 } from "./peak-traffic/v2";
import { headroomUnderCpuPressureV2 } from "./headroom-under-cpu-pressure/v2";
import { boundRetriesDuringSlowdownV1 } from "./bound-retries-during-slowdown/v1";

/* Every published version of every challenge, calibrated against simulation model
"1" and catalog "2026-08". Versions are immutable and never removed: historical
attempts are judged by exactly the version that created them. Order sets the
challenge list. See ../README.md for the authoring rules. */
export const CHALLENGE_VERSIONS: readonly ChallengeDefinition[] = [
  firstProductionApiV1,
  secureTheEdgeV1,
  cacheMattersV1,
  writeHeavyV1,
  scaleOutSafelyV1,
  peakTrafficV1,
  loseAnAppServerV1,
  cacheFailureV1,
  headroomUnderCpuPressureV1,
  afterTheCacheReturnsV1,
  // Model 2 versions (calibrated 2026-10-28).
  firstProductionApiV2,
  secureTheEdgeV2,
  cacheMattersV2,
  writeHeavyV2,
  scaleOutSafelyV2,
  peakTrafficV2,
  loseAnAppServerV2,
  headroomUnderCpuPressureV2,
  afterTheCacheReturnsV2,
  boundRetriesDuringSlowdownV1,
];
