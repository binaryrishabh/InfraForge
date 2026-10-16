ALTER TABLE "InternalModel2Grant" ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'operator';
ALTER TABLE "InternalModel2Grant" ADD CONSTRAINT internal_model2_grant_scope CHECK (scope IN ('operator','lesson'));
CREATE TABLE "InternalModel2LessonRun" (
  "runId" TEXT PRIMARY KEY REFERENCES "InternalModel2Run"(id) ON DELETE CASCADE,
  policy JSONB NOT NULL,
  receipt JSONB,
  CONSTRAINT model2_lesson_policy CHECK (COALESCE(jsonb_typeof(policy)='object' AND policy->>'schema'='object-restart/1' AND policy->>'image' ~ '^sha256:[a-f0-9]{64}$'
    AND policy->>'phase' IN ('before','during','after') AND policy->>'inputHash' ~ '^[a-f0-9]{64}$' AND policy->>'reviewHash' ~ '^[a-f0-9]{64}$'
    AND policy->>'fingerprint' ~ '^[a-f0-9]{64}$' AND jsonb_typeof(policy->'limits')='object' AND octet_length(policy::text)<=16384,false)),
  CONSTRAINT model2_lesson_receipt CHECK (receipt IS NULL OR octet_length(receipt::text)<=65536)
);
CREATE FUNCTION protect_model2_lesson() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM "InternalModel2Run" WHERE id=OLD."runId") THEN RAISE EXCEPTION 'Lesson metadata cannot be removed independently'; END IF;
    RETURN OLD;
  END IF;
  IF NOT COALESCE(jsonb_typeof(NEW.policy)='object' AND NEW.policy->>'schema'='object-restart/1' AND
     NEW.policy->>'image' ~ '^sha256:[a-f0-9]{64}$' AND NEW.policy->>'phase' IN ('before','during','after') AND
     NEW.policy->>'reviewHash' ~ '^[a-f0-9]{64}$' AND NEW.policy->>'fingerprint' ~ '^[a-f0-9]{64}$' AND
     jsonb_typeof(NEW.policy->'limits')='object',false) OR octet_length(NEW.policy::text)>16384 OR
     (NEW.receipt IS NOT NULL AND octet_length(NEW.receipt::text)>65536) OR
     NOT EXISTS (SELECT 1 FROM "InternalModel2Run" WHERE id=NEW."runId" AND "inputHash"=NEW.policy->>'inputHash'
       AND input->'contract'->>'version'='object-restart/1') THEN RAISE EXCEPTION 'Invalid bounded lesson policy'; END IF;
  IF TG_OP='UPDATE' AND ((NEW."runId",NEW.policy) IS DISTINCT FROM (OLD."runId",OLD.policy) OR
     NOT EXISTS (SELECT 1 FROM "InternalModel2Run" WHERE id=OLD."runId" AND status='running')) THEN
    RAISE EXCEPTION 'Lesson policy and terminal receipt are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER model2_lesson_guard BEFORE INSERT OR UPDATE OR DELETE ON "InternalModel2LessonRun" FOR EACH ROW EXECUTE FUNCTION protect_model2_lesson();
-- The original M2K guard is unchanged. A deferred guard closes the new scoped path.
CREATE FUNCTION require_model2_lesson() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((SELECT scope FROM "InternalModel2Grant" WHERE "userId"=NEW."ownerId")='lesson' OR
      NEW.input->'contract'->>'version'='object-restart/1') AND
     NOT EXISTS (SELECT 1 FROM "InternalModel2LessonRun" WHERE "runId"=NEW.id) THEN
    RAISE EXCEPTION 'Lesson-scoped admission requires immutable lesson metadata';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER model2_lesson_admission AFTER INSERT ON "InternalModel2Run"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_model2_lesson();
