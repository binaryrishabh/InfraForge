BEGIN;

ALTER TABLE "Deployment"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "runName" TEXT,
  ADD COLUMN "actionSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "terminalSnapshot" JSONB;

-- Only the already verified design owner is evidence of ownership. NULL stays NULL.
UPDATE "Deployment" d SET "ownerId" = i."ownerId", "runName" = i.name
  FROM "Infrastructure" i WHERE d."infrastructureId" = i.id;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Deployment_ownerId_createdAt_id_idx" ON "Deployment"("ownerId", "createdAt", id);
CREATE INDEX "Deployment_infrastructureId_idx" ON "Deployment"("infrastructureId");
ALTER TABLE "Deployment" ALTER COLUMN "infrastructureId" DROP NOT NULL;
ALTER TABLE "Deployment" DROP CONSTRAINT "Deployment_infrastructureId_fkey";
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_infrastructureId_fkey"
  FOREIGN KEY ("infrastructureId") REFERENCES "Infrastructure"(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION capture_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE design_owner TEXT; design_name TEXT;
BEGIN
  IF NEW."infrastructureId" IS NOT NULL THEN
    SELECT "ownerId", name INTO design_owner, design_name FROM "Infrastructure" WHERE id = NEW."infrastructureId" FOR KEY SHARE;
    IF NEW."ownerId" IS NOT NULL AND NEW."ownerId" IS DISTINCT FROM design_owner THEN
      RAISE EXCEPTION 'Run owner must match the verified design owner';
    END IF;
    NEW."ownerId" := design_owner;
    NEW."runName" := design_name;
  ELSIF NEW."ownerId" IS NOT NULL THEN
    RAISE EXCEPTION 'New owned runs require a design';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_identity_capture BEFORE INSERT ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION capture_run_identity();

CREATE FUNCTION protect_run_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."infrastructureId" IS DISTINCT FROM OLD."infrastructureId" AND
      (NEW."infrastructureId" IS NOT NULL OR OLD.status IN ('pending', 'running', 'live') OR OLD."runtimeActive") THEN
    RAISE EXCEPTION 'Active runs cannot be detached and historical runs cannot be retargeted';
  END IF;
  IF NEW."runName" IS DISTINCT FROM OLD."runName" OR
      (OLD."terminalSnapshot" IS NOT NULL AND NEW."terminalSnapshot" IS DISTINCT FROM OLD."terminalSnapshot") THEN
    RAISE EXCEPTION 'Captured run name and terminal snapshot are immutable';
  END IF;
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" AND (
      OLD."ownerId" IS NOT NULL OR OLD.status IN ('pending', 'running', 'live') OR OLD."runtimeActive" OR
      NOT EXISTS (SELECT 1 FROM "Infrastructure" WHERE id = OLD."infrastructureId" AND "ownerId" = NEW."ownerId")) THEN
    RAISE EXCEPTION 'Run ownership recovery requires an inactive unassigned run and verified design owner';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_evidence_guard BEFORE UPDATE OF "ownerId", "runName", "terminalSnapshot", "infrastructureId" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_run_evidence();

CREATE FUNCTION protect_design_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Deployment" WHERE "infrastructureId" = OLD.id
      AND (status IN ('pending', 'running', 'live') OR "runtimeActive")) THEN
    RAISE EXCEPTION 'Stop active deployments before deleting their design';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER design_active_delete_guard BEFORE DELETE ON "Infrastructure"
  FOR EACH ROW EXECUTE FUNCTION protect_design_history();

CREATE TABLE "RunAction" (
  id TEXT PRIMARY KEY,
  "deploymentId" TEXT NOT NULL REFERENCES "Deployment"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (kind IN ('load', 'speed', 'chaos', 'vertical-scale', 'pool-scale', 'topology', 'teardown')),
  parameters JSONB NOT NULL CHECK (jsonb_typeof(parameters) = 'object' AND octet_length(parameters::text) <= 131072),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'applying', 'running', 'completed', 'failed', 'cancelled')),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "appliedSimulatedSeconds" INTEGER CHECK ("appliedSimulatedSeconds" >= 0),
  "completedSimulatedSeconds" INTEGER CHECK ("completedSimulatedSeconds" >= 0),
  outcome JSONB CHECK (outcome IS NULL OR (jsonb_typeof(outcome) = 'object' AND octet_length(outcome::text) <= 32768)),
  "failureReason" VARCHAR(500),
  CHECK (status NOT IN ('running', 'completed') OR ("appliedAt" IS NOT NULL AND "appliedSimulatedSeconds" IS NOT NULL)),
  CHECK (status NOT IN ('completed', 'failed', 'cancelled') OR "completedAt" IS NOT NULL),
  CHECK (status <> 'completed' OR "completedSimulatedSeconds" IS NOT NULL),
  CHECK ("completedSimulatedSeconds" IS NULL OR "appliedSimulatedSeconds" IS NULL OR "completedSimulatedSeconds" >= "appliedSimulatedSeconds")
);
CREATE UNIQUE INDEX "RunAction_deploymentId_sequence_key" ON "RunAction"("deploymentId", sequence);
CREATE INDEX "RunAction_deploymentId_status_sequence_idx" ON "RunAction"("deploymentId", status, sequence);
CREATE UNIQUE INDEX run_action_open_teardown ON "RunAction"("deploymentId")
  WHERE kind = 'teardown' AND status IN ('requested', 'applying', 'running');

CREATE FUNCTION protect_run_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."deploymentId", NEW.sequence, NEW.kind, NEW.parameters, NEW."requestedAt")
      IS DISTINCT FROM ROW(OLD."deploymentId", OLD.sequence, OLD.kind, OLD.parameters, OLD."requestedAt") THEN
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
CREATE TRIGGER run_action_evidence_guard BEFORE UPDATE ON "RunAction"
  FOR EACH ROW EXECUTE FUNCTION protect_run_action();

COMMIT;
