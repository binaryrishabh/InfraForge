-- Existing deployments remain identifiable as legacy: no input backfill.
ALTER TABLE "Deployment"
  ADD COLUMN "runInputs" JSONB,
  ADD COLUMN "liveTopology" JSONB,
  ADD COLUMN "topologyRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "runtimeActive" BOOLEAN NOT NULL DEFAULT false;

CREATE FUNCTION protect_deployment_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."runInputs" IS DISTINCT FROM OLD."runInputs" THEN
    RAISE EXCEPTION 'Deployment run inputs are immutable';
  END IF;
  IF OLD."runInputs" IS NOT NULL AND (NEW.seed IS DISTINCT FROM OLD.seed
      OR NEW."workloadProfile" IS DISTINCT FROM OLD."workloadProfile") THEN
    RAISE EXCEPTION 'Captured seed and workload are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deployment_inputs_immutable BEFORE UPDATE OF "runInputs", seed, "workloadProfile" ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_deployment_inputs();

-- Also guard cascade deletion and direct deletion outside the API.
CREATE FUNCTION protect_active_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('pending', 'running', 'live') OR OLD."runtimeActive" THEN
    RAISE EXCEPTION 'Stop active deployments before deleting them';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER deployment_active_delete_guard BEFORE DELETE ON "Deployment"
  FOR EACH ROW EXECUTE FUNCTION protect_active_deployment();
