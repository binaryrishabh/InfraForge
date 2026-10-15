BEGIN;

ALTER TABLE "Deployment"
  ADD COLUMN "improvementSourceId" TEXT,
  ADD COLUMN "learningHypothesis" VARCHAR(400),
  ADD COLUMN "learningIntent" TEXT,
  ADD CONSTRAINT "Deployment_improvementSourceId_fkey" FOREIGN KEY ("improvementSourceId") REFERENCES "Deployment"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT deployment_learning_complete CHECK (
    ("improvementSourceId" IS NULL AND "learningHypothesis" IS NULL AND "learningIntent" IS NULL) OR
    COALESCE("challengeId" IS NOT NULL AND "learningIntent" IN ('improvement','repeat') AND
      length(btrim("learningHypothesis")) BETWEEN 1 AND 400, false));
CREATE INDEX "Deployment_improvementSourceId_createdAt_id_idx" ON "Deployment"("improvementSourceId", "createdAt", id);

CREATE FUNCTION verify_challenge_learning() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "Deployment"%ROWTYPE;
BEGIN
  IF NEW."learningIntent" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO source FROM "Deployment" WHERE id = NEW."improvementSourceId" FOR SHARE;
  IF NOT FOUND OR source.id = NEW.id OR NEW."ownerId" IS NULL OR source."ownerId" IS DISTINCT FROM NEW."ownerId" OR
      source.status NOT IN ('completed','failed','torn-down') OR source."runtimeActive" OR
      source."challengeId" IS NULL OR NEW."challengeId" IS DISTINCT FROM source."challengeId" OR
      NEW."challengeVersion" IS DISTINCT FROM source."challengeVersion" OR NEW."challengeSpecHash" IS DISTINCT FROM source."challengeSpecHash" OR
      NEW."evaluationStopAtSimulatedSeconds" IS DISTINCT FROM source."evaluationStopAtSimulatedSeconds" OR
      NEW."challengeExperiment" IS DISTINCT FROM source."challengeExperiment" OR
      source."runInputs"->>'version' IS DISTINCT FROM '2' OR NEW."runInputs"->>'version' IS DISTINCT FROM '2' OR
      NEW."runInputs"->'simulationModelVersion' IS DISTINCT FROM source."runInputs"->'simulationModelVersion' OR
      NEW."runInputs"->'catalogSnapshot' IS DISTINCT FROM source."runInputs"->'catalogSnapshot' OR
      NEW."runInputs"->'workloadProfile' IS DISTINCT FROM source."runInputs"->'workloadProfile' OR
      NEW."runInputs"->'seed' IS DISTINCT FROM source."runInputs"->'seed' OR NEW.status IS DISTINCT FROM 'pending' OR NEW."runtimeActive" THEN
    RAISE EXCEPTION 'Learning attempts require an inactive same-owner source and identical challenge conditions';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_learning_insert BEFORE INSERT ON "Deployment" FOR EACH ROW EXECUTE FUNCTION verify_challenge_learning();

CREATE FUNCTION protect_challenge_learning() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."learningHypothesis" IS DISTINCT FROM OLD."learningHypothesis" OR NEW."learningIntent" IS DISTINCT FROM OLD."learningIntent" OR
    (NEW."improvementSourceId" IS DISTINCT FROM OLD."improvementSourceId" AND NOT
      (NEW."improvementSourceId" IS NULL AND NOT EXISTS (SELECT 1 FROM "Deployment" WHERE id = OLD."improvementSourceId"))) THEN
    RAISE EXCEPTION 'Learning hypothesis, intent and source are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_learning_guard BEFORE UPDATE OF "improvementSourceId", "learningHypothesis", "learningIntent" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_learning();

COMMIT;
