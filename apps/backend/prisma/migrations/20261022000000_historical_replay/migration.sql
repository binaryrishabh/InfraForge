-- Strictly additive: original runs, inputs, cuts and results are unchanged.
CREATE TABLE "FirstStackReplay" (
  id TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "FirstStackRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  fingerprint VARCHAR(64) NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  delivered BOOLEAN NOT NULL DEFAULT false, cancelled BOOLEAN NOT NULL DEFAULT false,
  daemon VARCHAR(64), result JSONB, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT first_stack_replay CHECK ((fingerprint ~ '^[a-f0-9]{64}$'
    AND status IN ('queued','running','recovery','terminal')
    AND (status NOT IN ('running','recovery') OR daemon ~ '^[a-f0-9]{64}$')
    AND (status<>'terminal' OR (result->>'kind' IN ('MatchesRecordedPrefix','Mismatch','Unavailable') AND octet_length(result::text)<=16384))) IS TRUE)
);
CREATE INDEX "FirstStackReplay_status_idx" ON "FirstStackReplay"(status);
CREATE FUNCTION protect_first_stack_replay() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recorded "FirstStackRun";
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Historical replay records are retained'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'queued' OR NEW.daemon IS NOT NULL OR NEW.result IS NOT NULL OR NEW.cancelled OR NEW.delivered
      OR NOT EXISTS (SELECT 1 FROM "FirstStackRun" r JOIN "FirstStackWork" w ON w."runId"=r.id
        WHERE r.id=NEW."runId" AND r."ownerId"=NEW."ownerId" AND w.status='terminal' AND w.authorized)
      OR NEW.fingerprint IS DISTINCT FROM (SELECT body->>'fingerprint' FROM "FirstStackCut" WHERE "runId"=NEW."runId" ORDER BY sequence DESC LIMIT 1)
    THEN RAISE EXCEPTION 'Historical replay requires an owned authorized durable prefix'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='terminal' OR NEW.id<>OLD.id OR NEW."runId"<>OLD."runId" OR NEW."ownerId"<>OLD."ownerId"
    OR NEW.fingerprint<>OLD.fingerprint OR NEW."createdAt"<>OLD."createdAt"
    OR (OLD.delivered AND NOT NEW.delivered) OR (OLD.cancelled AND NOT NEW.cancelled)
    OR (OLD.daemon IS NOT NULL AND NEW.daemon IS DISTINCT FROM OLD.daemon)
    OR (OLD.status='queued' AND NEW.status NOT IN ('queued','running','terminal'))
    OR (OLD.status='running' AND NEW.status NOT IN ('running','recovery','terminal'))
    OR (OLD.status='recovery' AND NEW.status<>'recovery' AND NOT COALESCE(
      NEW.status='terminal' AND NEW.result->>'kind'='Unavailable'
      AND NEW.result->'recovery'->>'daemon'=OLD.daemon
      AND NEW.result->'recovery'->>'token'=OLD.id
      AND NEW.result->'recovery'->>'cleanup' IN ('removed','not-created')
      AND length(NEW.result->'recovery'->>'reviewer') BETWEEN 1 AND 256
      AND length(NEW.result->'recovery'->>'proof') BETWEEN 1 AND 500, false))
    OR (NEW.status<>'terminal' AND NEW.result IS NOT NULL)
  THEN RAISE EXCEPTION 'Invalid historical replay transition'; END IF;
  IF NEW.status='terminal' AND NEW.result->>'kind' IN ('MatchesRecordedPrefix','Mismatch') THEN
    SELECT * INTO recorded FROM "FirstStackRun" WHERE id=OLD."runId";
    IF NOT COALESCE(OLD.status='running' AND NOT NEW.cancelled
      AND EXISTS (SELECT 1 FROM "FirstStackWork" WHERE "runId"=OLD."runId" AND authorized)
      AND NEW.result->>'inputHash'=recorded."inputHash" AND NEW.result->>'expected'=OLD.fingerprint
      AND NEW.result->>'actual' ~ '^[a-f0-9]{64}$'
      AND ((NEW.result->>'kind'='MatchesRecordedPrefix')=(NEW.result->>'actual'=OLD.fingerprint))
      AND (NEW.result->>'throughUs')::bigint BETWEEN 0 AND 300000000
      AND (NEW.result->>'processed')::bigint BETWEEN 0 AND 2000000
      AND NEW.result->'receipt'->>'cleanup'='removed'
      AND NEW.result->'receipt'->>'daemon'=OLD.daemon
      AND NEW.result->'receipt'->>'image'=recorded.engine->>'image', false)
    THEN RAISE EXCEPTION 'Historical replay requires matching pinned executor evidence and cleanup'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER first_stack_replay_guard BEFORE INSERT OR UPDATE OR DELETE ON "FirstStackReplay" FOR EACH ROW EXECUTE FUNCTION protect_first_stack_replay();

-- Additional insert-only lineage guard; old records and guards are preserved.
CREATE FUNCTION verify_first_stack_migration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "Deployment"; migration JSONB; reference JSONB;
BEGIN
  IF NOT (NEW.lineage ? 'migratedFrom') THEN RETURN NEW; END IF;
  reference := NEW.lineage->'migratedFrom';
  SELECT * INTO source FROM "Deployment" WHERE id=reference->>'id' AND "ownerId"=NEW."ownerId";
  migration := NEW.input::jsonb->'candidate'->'migration';
  IF NOT COALESCE(source.id IS NOT NULL AND source.id<>NEW.id AND source."infrastructureId" IS NOT NULL
    AND NEW.lineage->>'infrastructureId'<>source."infrastructureId"
    AND reference=jsonb_build_object('engine','1','store','Deployment','id',source.id)
    AND migration->>'kind'='reviewed-copy' AND migration->>'reviewedBy'=NEW."ownerId"
    AND migration->>'fromInfrastructureId'=source."infrastructureId", false)
  THEN RAISE EXCEPTION 'Migration requires a distinct Model 2 run and owned reviewed design copy'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER first_stack_migration_guard BEFORE INSERT ON "FirstStackRun" FOR EACH ROW EXECUTE FUNCTION verify_first_stack_migration();
