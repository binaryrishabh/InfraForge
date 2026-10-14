BEGIN;

-- A challenge workspace belongs to one version of its challenge. Every existing
-- workspace was created while version 1 was the only version.
ALTER TABLE "Infrastructure" ADD COLUMN "challengeVersion" INTEGER;
UPDATE "Infrastructure" SET "challengeVersion" = 1 WHERE "challengeId" IS NOT NULL;
ALTER TABLE "Infrastructure" ADD CONSTRAINT infrastructure_challenge_version CHECK (
  ("challengeId" IS NULL) = ("challengeVersion" IS NULL) AND COALESCE("challengeVersion" > 0, true));
DROP INDEX "Infrastructure_ownerId_challengeId_idx";
CREATE INDEX "Infrastructure_ownerId_challengeId_challengeVersion_idx" ON "Infrastructure"("ownerId", "challengeId", "challengeVersion");

CREATE OR REPLACE FUNCTION protect_challenge_design() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."challengeId" IS DISTINCT FROM OLD."challengeId" OR NEW."challengeVersion" IS DISTINCT FROM OLD."challengeVersion" THEN
    RAISE EXCEPTION 'A design''s challenge workspace identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER infrastructure_challenge_guard ON "Infrastructure";
CREATE TRIGGER infrastructure_challenge_guard BEFORE UPDATE OF "challengeId", "challengeVersion" ON "Infrastructure"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_design();

-- A resilience attempt records its experiment plan, resolved from the versioned
-- definition, in the same insert that creates it. The plan is bounded and the
-- fault is always due before the evaluation second.
ALTER TABLE "Deployment"
  ADD COLUMN "challengeExperiment" JSONB,
  ADD CONSTRAINT deployment_challenge_experiment CHECK ("challengeExperiment" IS NULL OR COALESCE(
    "challengeId" IS NOT NULL AND jsonb_typeof("challengeExperiment") = 'object' AND octet_length("challengeExperiment"::text) <= 1024 AND
    jsonb_typeof("challengeExperiment"->'fault') = 'string' AND jsonb_typeof("challengeExperiment"->'targetResourceId') = 'string' AND
    jsonb_typeof("challengeExperiment"->'atSimulatedSecond') = 'number' AND jsonb_typeof("challengeExperiment"->'durationSimulatedSeconds') = 'number' AND
    ("challengeExperiment"->>'atSimulatedSecond')::numeric >= 1 AND
    ("challengeExperiment"->>'atSimulatedSecond')::numeric < "evaluationStopAtSimulatedSeconds", false));

CREATE OR REPLACE FUNCTION verify_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE design_challenge TEXT; design_version INTEGER; design_owner TEXT;
BEGIN
  IF NEW."challengeId" IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'pending' OR NEW."runtimeActive" OR NEW."terminalSnapshot" IS NOT NULL THEN
    RAISE EXCEPTION 'A challenge prediction must be recorded before the attempt starts';
  END IF;
  -- The prediction is written in the same insert that creates the attempt, so it
  -- always exists before the worker can start the simulation.
  NEW."predictionSubmittedAt" := now();
  SELECT "challengeId", "challengeVersion", "ownerId" INTO design_challenge, design_version, design_owner
    FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR KEY SHARE;
  IF NOT FOUND OR design_challenge IS DISTINCT FROM NEW."challengeId" OR design_version IS DISTINCT FROM NEW."challengeVersion"
     OR design_owner IS DISTINCT FROM NEW."ownerId" OR NEW."ownerId" IS NULL THEN
    RAISE EXCEPTION 'Challenge attempts require the owner''s workspace design for that challenge version';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."challengeId", NEW."challengeVersion", NEW."challengeSpecHash", NEW."challengePrediction",
         NEW."predictionSubmittedAt", NEW."evaluationStopAtSimulatedSeconds", NEW."challengeExperiment")
     IS DISTINCT FROM ROW(OLD."challengeId", OLD."challengeVersion", OLD."challengeSpecHash", OLD."challengePrediction",
         OLD."predictionSubmittedAt", OLD."evaluationStopAtSimulatedSeconds", OLD."challengeExperiment") THEN
    RAISE EXCEPTION 'Challenge identity, prediction, experiment and evaluation time are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER deployment_challenge_guard ON "Deployment";
CREATE TRIGGER deployment_challenge_guard BEFORE UPDATE OF "challengeId", "challengeVersion", "challengeSpecHash",
  "challengePrediction", "predictionSubmittedAt", "evaluationStopAtSimulatedSeconds", "challengeExperiment" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_attempt();

-- People can change only speed and stop during an attempt. The one exception is the
-- attempt's own scheduled fault, which the worker records with a trigger marker and
-- which must match the recorded plan exactly. Nothing else may carry that marker.
CREATE OR REPLACE FUNCTION restrict_challenge_actions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt TEXT; plan JSONB;
BEGIN
  SELECT "challengeId", "challengeExperiment" INTO attempt, plan FROM "Deployment" WHERE id = NEW."deploymentId";
  IF NEW.kind = 'chaos' AND NEW.parameters ? 'trigger' THEN
    IF attempt IS NULL OR plan IS NULL OR NEW.parameters->>'trigger' IS DISTINCT FROM 'challenge-experiment'
       OR NEW.parameters->>'type' IS DISTINCT FROM plan->>'fault'
       OR NEW.parameters->>'resourceId' IS DISTINCT FROM plan->>'targetResourceId' THEN
      RAISE EXCEPTION 'Only an attempt''s recorded experiment can schedule a challenge fault';
    END IF;
    RETURN NEW;
  END IF;
  IF attempt IS NOT NULL AND NEW.kind NOT IN ('speed', 'teardown') THEN
    RAISE EXCEPTION 'Challenge attempts accept only speed changes and stopping';
  END IF;
  RETURN NEW;
END $$;

-- At most one scheduled fault per attempt, so a retried write can never add a second one.
CREATE UNIQUE INDEX run_action_challenge_experiment ON "RunAction"("deploymentId") WHERE kind = 'chaos' AND parameters ? 'trigger';

COMMIT;
