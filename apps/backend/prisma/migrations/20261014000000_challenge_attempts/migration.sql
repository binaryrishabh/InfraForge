BEGIN;

-- A design created for a challenge stays that challenge's workspace.
ALTER TABLE "Infrastructure"
  ADD COLUMN "challengeId" TEXT CHECK ("challengeId" IS NULL OR "challengeId" ~ '^[a-z0-9-]{1,64}$');
CREATE INDEX "Infrastructure_ownerId_challengeId_idx" ON "Infrastructure"("ownerId", "challengeId");

-- Challenge attempts are ordinary deployments with a verified challenge identity,
-- an immutable prediction and their own evaluation horizon. Reruns keep using the
-- separate matched-stop column from migration 12.
ALTER TABLE "Deployment"
  ADD COLUMN "challengeId" TEXT,
  ADD COLUMN "challengeVersion" INTEGER,
  ADD COLUMN "challengeSpecHash" TEXT,
  ADD COLUMN "challengePrediction" JSONB,
  ADD COLUMN "predictionSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "evaluationStopAtSimulatedSeconds" INTEGER,
  ADD CONSTRAINT deployment_challenge_complete CHECK (
    ("challengeId" IS NULL AND "challengeVersion" IS NULL AND "challengeSpecHash" IS NULL AND
      "challengePrediction" IS NULL AND "predictionSubmittedAt" IS NULL AND "evaluationStopAtSimulatedSeconds" IS NULL)
    -- COALESCE: a NULL in any field must fail the check, not leave it unknown (which CHECK accepts).
    OR COALESCE("challengeId" ~ '^[a-z0-9-]{1,64}$' AND "challengeVersion" > 0 AND "challengeSpecHash" ~ '^[a-f0-9]{64}$' AND
      jsonb_typeof("challengePrediction") = 'object' AND octet_length("challengePrediction"::text) <= 8192 AND
      "predictionSubmittedAt" IS NOT NULL AND "evaluationStopAtSimulatedSeconds" BETWEEN 1 AND 3600, false)),
  ADD CONSTRAINT deployment_challenge_not_rerun CHECK ("challengeId" IS NULL OR ("sourceRunId" IS NULL AND "autoStopAtSimulatedSeconds" IS NULL));
CREATE INDEX "Deployment_ownerId_challengeId_createdAt_idx" ON "Deployment"("ownerId", "challengeId", "createdAt");

CREATE FUNCTION verify_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE design_challenge TEXT; design_owner TEXT;
BEGIN
  IF NEW."challengeId" IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'pending' OR NEW."runtimeActive" OR NEW."terminalSnapshot" IS NOT NULL THEN
    RAISE EXCEPTION 'A challenge prediction must be recorded before the attempt starts';
  END IF;
  -- The prediction is written in the same insert that creates the attempt, so it
  -- always exists before the worker can start the simulation.
  NEW."predictionSubmittedAt" := now();
  SELECT "challengeId", "ownerId" INTO design_challenge, design_owner FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR KEY SHARE;
  IF NOT FOUND OR design_challenge IS DISTINCT FROM NEW."challengeId" OR design_owner IS DISTINCT FROM NEW."ownerId" OR NEW."ownerId" IS NULL THEN
    RAISE EXCEPTION 'Challenge attempts require the owner''s workspace design for that challenge';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_challenge_attempt BEFORE INSERT ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION verify_challenge_attempt();

CREATE FUNCTION protect_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."challengeId", NEW."challengeVersion", NEW."challengeSpecHash", NEW."challengePrediction",
         NEW."predictionSubmittedAt", NEW."evaluationStopAtSimulatedSeconds")
     IS DISTINCT FROM ROW(OLD."challengeId", OLD."challengeVersion", OLD."challengeSpecHash", OLD."challengePrediction",
         OLD."predictionSubmittedAt", OLD."evaluationStopAtSimulatedSeconds") THEN
    RAISE EXCEPTION 'Challenge identity, prediction and evaluation time are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_challenge_guard BEFORE UPDATE OF "challengeId", "challengeVersion", "challengeSpecHash",
  "challengePrediction", "predictionSubmittedAt", "evaluationStopAtSimulatedSeconds" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_attempt();

CREATE FUNCTION protect_challenge_design() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."challengeId" IS DISTINCT FROM OLD."challengeId" THEN
    RAISE EXCEPTION 'A design''s challenge workspace identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER infrastructure_challenge_guard BEFORE UPDATE OF "challengeId" ON "Infrastructure"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_design();

-- During a challenge attempt only speed and stopping are accepted. Load, faults,
-- scaling and live edits would change what is being evaluated.
CREATE FUNCTION restrict_challenge_actions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind NOT IN ('speed', 'teardown') AND EXISTS (
      SELECT 1 FROM "Deployment" WHERE id = NEW."deploymentId" AND "challengeId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Challenge attempts accept only speed changes and stopping';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER run_action_challenge_guard BEFORE INSERT ON "RunAction"
  FOR EACH ROW EXECUTE FUNCTION restrict_challenge_actions();

COMMIT;
