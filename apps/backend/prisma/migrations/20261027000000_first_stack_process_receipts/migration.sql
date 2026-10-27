-- Add a distinct process owner; existing Docker rows and evidence are untouched.
ALTER TABLE "FirstStackWork" ADD COLUMN generation VARCHAR(36);
ALTER TABLE "FirstStackWork" DROP CONSTRAINT first_stack_work;
ALTER TABLE "FirstStackWork" ADD CONSTRAINT first_stack_work CHECK ((
  status IN ('queued','running','recovery','terminal') AND "captureBytes" BETWEEN 0 AND 33554432
  AND (generation IS NULL OR (status IN ('running','recovery','terminal') AND daemon IS NULL AND generation ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND token ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'))
  AND (status NOT IN ('running','recovery') OR (token IS NOT NULL AND
    ((generation IS NULL AND daemon IS NOT NULL AND daemon ~ '^[a-f0-9]{64}$') OR generation IS NOT NULL)))
) IS TRUE);

CREATE OR REPLACE FUNCTION protect_first_stack_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'First-stack reservation cannot be deleted'; END IF;
  IF OLD.status='terminal' OR NEW."runId"<>OLD."runId" OR NEW."captureBytes"<OLD."captureBytes"
    OR (OLD.token IS NOT NULL AND NEW.token IS DISTINCT FROM OLD.token)
    OR (OLD.generation IS NOT NULL AND NEW.generation IS DISTINCT FROM OLD.generation)
    OR (OLD.daemon IS NOT NULL AND NEW.daemon IS DISTINCT FROM OLD.daemon)
    OR (OLD."cancelRequested" AND NOT NEW."cancelRequested") OR (NOT OLD.authorized AND NEW.authorized)
    OR (OLD.status='queued' AND NEW.status NOT IN ('queued','running','terminal'))
    OR (OLD.status='running' AND NEW.status NOT IN ('running','recovery','terminal'))
    OR (OLD.status='recovery' AND NEW.status NOT IN ('recovery','terminal')) THEN
    RAISE EXCEPTION 'Invalid first-stack state transition';
  END IF;
  IF NEW.status='terminal' AND NOT EXISTS (SELECT 1 FROM "FirstStackResult" WHERE "runId"=NEW."runId") THEN
    RAISE EXCEPTION 'Terminal first-stack reservation requires immutable result';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION capture_first_stack_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w "FirstStackWork"; r "FirstStackRun"; used INTEGER; previous INTEGER; receipt JSONB; prefix JSONB; clean BOOLEAN; completed BOOLEAN;
BEGIN
  SELECT * INTO w FROM "FirstStackWork" WHERE "runId"=NEW."runId" FOR UPDATE;
  SELECT * INTO r FROM "FirstStackRun" WHERE id=NEW."runId";
  IF w."runId" IS NULL OR (w.status NOT IN ('queued','running') AND NOT (TG_TABLE_NAME='FirstStackResult' AND (w.status='recovery' OR (w.status='terminal' AND r.purpose='private')))) THEN
    RAISE EXCEPTION 'First-stack evidence ownership unavailable';
  END IF;
  IF w.status='recovery' AND NOT COALESCE(
    TG_TABLE_NAME='FirstStackResult' AND NEW.body->>'verification' IN ('interrupted','cancelled','unavailable')
    AND NEW.body->'recovery'->>'token'=w.token AND NEW.body->'recovery'->>'image'=r.engine->>'image'
    AND ((w.generation IS NULL AND NEW.body->'recovery'->>'kind'='operator-reviewed'
      AND NEW.body->'recovery'->>'daemon'=w.daemon AND NEW.body->'recovery'->>'cleanup' IN ('removed','not-created'))
    OR (w.generation IS NOT NULL AND NEW.body->'recovery'->>'kind'='process-service-stopped/1'
      AND NEW.body->'recovery'->>'generation'=w.generation AND NEW.body->'recovery'->>'source'=r.engine->>'source'
      AND NEW.body->'recovery'->>'termination'='confirmed'))
    AND length(NEW.body->'recovery'->>'reviewer') BETWEEN 1 AND 256
    AND length(NEW.body->'recovery'->>'proof') BETWEEN 1 AND 500, false) THEN
    RAISE EXCEPTION 'Recovery requires explicit matching operator cleanup evidence';
  END IF;
  used := octet_length(NEW.body::text);
  IF TG_TABLE_NAME='FirstStackCut' THEN
    SELECT COALESCE(max(sequence),0) INTO previous FROM "FirstStackCut" WHERE "runId"=NEW."runId";
    IF w.status<>'running' OR w."cancelRequested" OR NOT w.authorized OR NEW.sequence<>previous+1
      OR NEW.body->>'source' IS DISTINCT FROM r.engine->>'source' OR NEW.body->>'inputHash' IS DISTINCT FROM r."inputHash"
      OR NEW.body->'cut'->'lock' IS DISTINCT FROM r.lock THEN RAISE EXCEPTION 'Invalid first-stack cut fence or identity'; END IF;
  ELSE
    receipt := NEW.body->'receipt';
    IF w.generation IS NOT NULL AND w.status<>'recovery' THEN
      clean := COALESCE(w.status='running' AND receipt->>'schema'='first-stack-process-receipt/1'
        AND receipt->>'generation'=w.generation AND receipt->>'token'=w.token
        AND receipt->>'source'=r.engine->>'source' AND receipt->>'image'=r.engine->>'image'
        AND NOT (receipt ?| ARRAY['cleanup','container','daemon'])
        AND ((receipt->>'termination'='not-started' AND receipt->'exit'='null'::jsonb)
          OR (receipt->>'termination'='confirmed' AND jsonb_typeof(receipt->'exit')='object'
            AND ((jsonb_typeof(receipt->'exit'->'code')='number'
              AND receipt->'exit'->>'code' ~ '^(0|[1-9][0-9]{0,2})$'
              AND (receipt->'exit'->>'code')::integer BETWEEN 0 AND 255 AND receipt->'exit'->'signal'='null'::jsonb)
            OR (receipt->'exit'->'code'='null'::jsonb AND receipt->'exit'->>'signal' ~ '^SIG[A-Z0-9]{1,29}$')))), false);
      IF NOT clean OR NEW.body->>'verification' NOT IN ('verified','mismatch','interrupted') THEN
        RAISE EXCEPTION 'Process result requires matching ownership and confirmed termination';
      END IF;
      IF NEW.body->>'verification' IN ('verified','mismatch') THEN
        SELECT body INTO prefix FROM "FirstStackCut" WHERE "runId"=NEW."runId" ORDER BY sequence DESC LIMIT 1;
        completed := COALESCE(NOT w."cancelRequested" AND w.authorized
          AND receipt->>'termination'='confirmed' AND receipt->'exit'->'code'='0'::jsonb
          AND receipt->'exit'->'signal'='null'::jsonb
          AND prefix->'cut'->'completeness'->'horizonReached'='true'::jsonb
          AND (prefix->'cut'->'interruption' IS NULL OR prefix->'cut'->'interruption'='null'::jsonb)
          AND NEW.body->>'actual'=prefix->>'fingerprint'
          AND NEW.body->>'expected'=r."browserCut"->>'fingerprint'
          AND ((NEW.body->>'verification'='verified')=(NEW.body->>'actual'=r."browserCut"->>'fingerprint')), false);
        IF NOT completed THEN RAISE EXCEPTION 'Process verification requires complete acknowledged execution'; END IF;
      END IF;
    ELSIF receipt->>'schema'='first-stack-process-receipt/1' THEN
      RAISE EXCEPTION 'Process receipt requires captured process ownership';
    END IF;
    IF w.generation IS NULL AND NEW.body->>'verification'='verified' AND (w.status<>'running' OR w."cancelRequested" OR NOT w.authorized
      OR NEW.body->'receipt'->>'cleanup' IS DISTINCT FROM 'removed'
      OR NEW.body->'receipt'->>'daemon' IS DISTINCT FROM w.daemon
      OR NEW.body->'receipt'->>'image' IS DISTINCT FROM r.engine->>'image'
      OR NEW.body->>'actual' IS DISTINCT FROM r."browserCut"->>'fingerprint'
      OR NEW.body->>'actual' IS DISTINCT FROM (SELECT body->>'fingerprint' FROM "FirstStackCut" WHERE "runId"=NEW."runId" ORDER BY sequence DESC LIMIT 1)) THEN
      RAISE EXCEPTION 'Verification requires a matching server execution and acknowledged cleanup';
    END IF;
  END IF;
  -- Private submissions are born terminal and their result is inserted once.
  IF w.status<>'terminal' THEN
    UPDATE "FirstStackWork" SET "captureBytes"="captureBytes"+used WHERE "runId"=NEW."runId";
  END IF;
  RETURN NEW;
END;
$$;
