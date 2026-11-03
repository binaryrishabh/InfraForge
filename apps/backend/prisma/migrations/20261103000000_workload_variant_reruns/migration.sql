BEGIN;

-- Locate the original single-column mode check by its catalog identity.
DO $$
DECLARE mode_check TEXT;
BEGIN
  SELECT c.conname INTO STRICT mode_check
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'rerunMode'
    WHERE c.conrelid = '"Deployment"'::regclass AND c.contype = 'c' AND c.conkey = ARRAY[a.attnum];
  EXECUTE format('ALTER TABLE "Deployment" DROP CONSTRAINT %I', mode_check);
END $$;
ALTER TABLE "Deployment" ADD CONSTRAINT deployment_rerun_mode CHECK (
  "rerunMode" IS NULL OR "rerunMode" IN ('exact', 'current-design', 'workload-variant'));

CREATE OR REPLACE FUNCTION capture_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE design_owner TEXT; design_name TEXT; source "Deployment"%ROWTYPE;
BEGIN
  IF NEW."sourceRunId" IS NOT NULL THEN
    SELECT * INTO source FROM "Deployment" WHERE id = NEW."sourceRunId" FOR SHARE;
    IF NOT FOUND OR source.id = NEW.id OR NEW."ownerId" IS NULL OR source."ownerId" IS DISTINCT FROM NEW."ownerId" OR
        source.status NOT IN ('completed', 'failed', 'torn-down') OR source."runtimeActive" THEN
      RAISE EXCEPTION 'Rerun source must be an inactive run of the same verified owner';
    END IF;
    IF NEW."infrastructureId" IS DISTINCT FROM source."infrastructureId" THEN
      RAISE EXCEPTION 'Reruns must retain the source design identity';
    END IF;
    IF NEW."rerunMode" = 'exact' THEN
      IF source."runInputs"->>'version' IS DISTINCT FROM '2' OR NEW."runInputs" IS DISTINCT FROM source."runInputs" THEN
        RAISE EXCEPTION 'Exact reruns require identical captured V2 inputs';
      END IF;
      NEW."runName" := source."runName";
    ELSIF NEW."rerunMode" = 'workload-variant' THEN
      IF source."runInputs"->>'version' IS DISTINCT FROM '2' OR source."challengeId" IS NOT NULL OR source."challengeVersion" IS NOT NULL THEN
        RAISE EXCEPTION 'Workload variants require a freeform captured V2 source';
      END IF;
      IF (NEW."runInputs" - 'workloadProfile') IS DISTINCT FROM (source."runInputs" - 'workloadProfile') THEN
        RAISE EXCEPTION 'Workload variants must retain all other captured inputs';
      END IF;
      IF (NEW."runInputs"->'workloadProfile') - 'workloadDynamics' IS DISTINCT FROM (source."runInputs"->'workloadProfile') - 'workloadDynamics' THEN
        RAISE EXCEPTION 'Workload variants may change only workload dynamics';
      END IF;
      NEW."runName" := source."runName";
    ELSIF NEW."rerunMode" = 'current-design' AND NEW."infrastructureId" IS NOT NULL AND NEW."runInputs"->>'version' = '2' THEN
      SELECT "ownerId", name INTO design_owner, design_name FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR SHARE;
      IF design_owner IS DISTINCT FROM NEW."ownerId" THEN RAISE EXCEPTION 'Rerun design owner differs'; END IF;
      NEW."runName" := design_name;
    ELSE RAISE EXCEPTION 'Invalid rerun mode or missing current design';
    END IF;
    IF (NEW."rerunMode" <> 'workload-variant' AND NEW."runInputs"->'workloadProfile' IS DISTINCT FROM source."runInputs"->'workloadProfile') OR
        NEW."runInputs"->'seed' IS DISTINCT FROM source."runInputs"->'seed' OR
        to_jsonb(NEW.seed) IS DISTINCT FROM NEW."runInputs"->'seed' OR
        NEW."workloadProfile" IS DISTINCT FROM NEW."runInputs"->'workloadProfile' THEN
      RAISE EXCEPTION 'Rerun seed and resolved workload must match the source input';
    END IF;
    IF NEW."autoStopAtSimulatedSeconds" IS NOT NULL AND (
        source."terminalSnapshot"->>'kind' IS DISTINCT FROM 'terminal' OR source."terminalSnapshot"->>'version' IS DISTINCT FROM '1' OR
        to_jsonb(NEW."autoStopAtSimulatedSeconds") IS DISTINCT FROM source."terminalSnapshot"->'simulatedSeconds') THEN
      RAISE EXCEPTION 'Matched stop requires the exact source terminal duration';
    END IF;
  ELSE
    IF NEW."rerunMode" IS NOT NULL OR NEW."autoStopAtSimulatedSeconds" IS NOT NULL THEN RAISE EXCEPTION 'Rerun settings require a source'; END IF;
    IF NEW."infrastructureId" IS NOT NULL THEN
      SELECT "ownerId", name INTO design_owner, design_name FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR KEY SHARE;
      IF NEW."ownerId" IS NOT NULL AND NEW."ownerId" IS DISTINCT FROM design_owner THEN RAISE EXCEPTION 'Run owner must match the verified design owner'; END IF;
      NEW."ownerId" := design_owner; NEW."runName" := design_name;
    ELSIF NEW."ownerId" IS NOT NULL THEN RAISE EXCEPTION 'New owned runs require a design';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
