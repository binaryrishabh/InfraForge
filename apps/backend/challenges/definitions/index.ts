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
];
