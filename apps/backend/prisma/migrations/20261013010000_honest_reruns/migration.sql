BEGIN;

ALTER TABLE "Deployment"
  ADD COLUMN "sourceRunId" TEXT,
  ADD COLUMN "rerunMode" TEXT CHECK ("rerunMode" IS NULL OR "rerunMode" IN ('exact', 'current-design')),
  ADD COLUMN "autoStopAtSimulatedSeconds" INTEGER CHECK ("autoStopAtSimulatedSeconds" > 0 AND "autoStopAtSimulatedSeconds" <= 604800),
  ADD CONSTRAINT deployment_lineage_mode CHECK ("sourceRunId" IS NULL OR "rerunMode" IS NOT NULL),
  ADD CONSTRAINT "Deployment_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "Deployment"(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Deployment_sourceRunId_createdAt_id_idx" ON "Deployment"("sourceRunId", "createdAt", id);

-- Extend identity capture only for verified new reruns. Existing records stay untouched.
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
    ELSIF NEW."rerunMode" = 'current-design' AND NEW."infrastructureId" IS NOT NULL AND NEW."runInputs"->>'version' = '2' THEN
      SELECT "ownerId", name INTO design_owner, design_name FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR SHARE;
      IF design_owner IS DISTINCT FROM NEW."ownerId" THEN RAISE EXCEPTION 'Rerun design owner differs'; END IF;
      NEW."runName" := design_name;
    ELSE RAISE EXCEPTION 'Invalid rerun mode or missing current design';
    END IF;
    IF NEW."runInputs"->'workloadProfile' IS DISTINCT FROM source."runInputs"->'workloadProfile' OR
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

CREATE FUNCTION protect_run_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."rerunMode" IS DISTINCT FROM OLD."rerunMode" OR NEW."autoStopAtSimulatedSeconds" IS DISTINCT FROM OLD."autoStopAtSimulatedSeconds" OR
      (NEW."sourceRunId" IS DISTINCT FROM OLD."sourceRunId" AND NOT
        (NEW."sourceRunId" IS NULL AND NOT EXISTS (SELECT 1 FROM "Deployment" WHERE id = OLD."sourceRunId"))) THEN
    RAISE EXCEPTION 'Captured rerun lineage and matched stop are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_lineage_guard BEFORE UPDATE OF "sourceRunId", "rerunMode", "autoStopAtSimulatedSeconds" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_run_lineage();

COMMIT;
