BEGIN;

ALTER TABLE "Deployment" ADD COLUMN "challengeScenario" JSONB,
  ADD CONSTRAINT deployment_challenge_scenario CHECK ("challengeScenario" IS NULL OR COALESCE(
    "challengeId" IS NOT NULL AND "challengeExperiment" IS NULL AND
    jsonb_typeof("challengeScenario") = 'object' AND octet_length("challengeScenario"::text) <= 65536 AND
    "challengeScenario"->>'version' = '1' AND "challengeScenario"->>'visibility' IN ('revealed','debrief') AND
    "challengeScenario"->>'definitionHash' = "challengeSpecHash" AND
    "challengeScenario"->>'simulationModelVersion' = '2' AND
    "runInputs"->>'simulationModelVersion' = '2' AND
    "challengeScenario"->'catalogSnapshot' = "runInputs"->'catalogSnapshot' AND
    "challengeScenario"->'adapterProfiles' = COALESCE("runInputs"->'adapterProfiles', '[]'::jsonb) AND
    jsonb_typeof("challengeScenario"->'steps') = 'array' AND jsonb_array_length("challengeScenario"->'steps') BETWEEN 1 AND 20 AND
    jsonb_typeof("challengeScenario"->'receipts') = 'array' AND
    jsonb_array_length("challengeScenario"->'receipts') = jsonb_array_length("challengeScenario"->'steps'), false));

ALTER TABLE "RunAction" ADD COLUMN "scenarioStepId" TEXT;
CREATE UNIQUE INDEX "RunAction_deploymentId_scenarioStepId_key" ON "RunAction"("deploymentId", "scenarioStepId");

CREATE OR REPLACE FUNCTION protect_challenge_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."challengeId", NEW."challengeVersion", NEW."challengeSpecHash", NEW."challengePrediction",
         NEW."predictionSubmittedAt", NEW."evaluationStopAtSimulatedSeconds", NEW."challengeExperiment", NEW."challengeScenario")
     IS DISTINCT FROM ROW(OLD."challengeId", OLD."challengeVersion", OLD."challengeSpecHash", OLD."challengePrediction",
         OLD."predictionSubmittedAt", OLD."evaluationStopAtSimulatedSeconds", OLD."challengeExperiment", OLD."challengeScenario") THEN
    RAISE EXCEPTION 'Challenge identity, prediction, experiment, scenario and evaluation time are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER deployment_challenge_guard ON "Deployment";
CREATE TRIGGER deployment_challenge_guard BEFORE UPDATE OF "challengeId", "challengeVersion", "challengeSpecHash",
  "challengePrediction", "predictionSubmittedAt", "evaluationStopAtSimulatedSeconds", "challengeExperiment", "challengeScenario" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_challenge_attempt();

CREATE OR REPLACE FUNCTION restrict_challenge_actions() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt TEXT; plan JSONB; scenario JSONB; matches INTEGER;
BEGIN
  SELECT "challengeId", "challengeExperiment", "challengeScenario" INTO attempt, plan, scenario FROM "Deployment" WHERE id = NEW."deploymentId";
  IF NEW."scenarioStepId" IS NOT NULL THEN
    IF attempt IS NULL OR scenario IS NULL OR NEW.kind IS DISTINCT FROM 'intervention' THEN
      RAISE EXCEPTION 'Only a recorded scenario can schedule a scenario step';
    END IF;
    SELECT count(*) INTO matches FROM jsonb_array_elements(scenario->'steps') AS step
      WHERE step->>'id' = NEW."scenarioStepId" AND step->'request' = NEW.parameters;
    IF matches <> 1 THEN RAISE EXCEPTION 'Scenario action must exactly match its stored step'; END IF;
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION protect_run_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."deploymentId", NEW.sequence, NEW.kind, NEW.parameters, NEW."requestedAt", NEW."scenarioStepId")
      IS DISTINCT FROM ROW(OLD."deploymentId", OLD.sequence, OLD.kind, OLD.parameters, OLD."requestedAt", OLD."scenarioStepId") THEN
    RAISE EXCEPTION 'Requested run actions are immutable';
  END IF;
  IF OLD.status IN ('completed', 'failed', 'cancelled') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Closed run action outcomes are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'requested' AND NEW.status IN ('applying', 'failed', 'cancelled')) OR
      (OLD.status = 'applying' AND NEW.status IN ('running', 'completed', 'failed', 'cancelled')) OR
      (OLD.status = 'running' AND NEW.status IN ('completed', 'failed', 'cancelled'))) THEN
    RAISE EXCEPTION 'Invalid run action lifecycle transition';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
