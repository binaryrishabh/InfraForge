-- Additive only. No activation, changes to historic runs, or blanket grants.
CREATE TABLE "FirstStackRun" (
  id TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "idempotencyKey" VARCHAR(80) NOT NULL, "requestHash" VARCHAR(64) NOT NULL,
  purpose TEXT NOT NULL, engine JSONB NOT NULL, input TEXT NOT NULL, "inputHash" VARCHAR(64) NOT NULL,
  lock JSONB NOT NULL, seed VARCHAR(256) NOT NULL, workload JSONB NOT NULL, envelope JSONB NOT NULL,
  lineage JSONB NOT NULL, "browserCut" JSONB NOT NULL, "inputBytes" INTEGER NOT NULL, "reservedBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT first_stack_input CHECK ((
    purpose IN ('private','scored','shared') AND "requestHash" ~ '^[a-f0-9]{64}$' AND "inputHash" ~ '^[a-f0-9]{64}$'
    AND engine->>'source' ~ '^[a-f0-9]{64}$' AND engine->>'image' ~ '^sha256:[a-f0-9]{64}$'
    AND octet_length(input) BETWEEN 1 AND 16777216 AND "inputBytes"=octet_length(input)
    AND "reservedBytes"="inputBytes"+33554432 AND octet_length("browserCut"::text)<=2097152
    AND input::jsonb->'policy'->>'seed'=seed AND input::jsonb->'owner'=to_jsonb("ownerId")
    AND (input::jsonb->'policy'->>'horizonUs')::bigint BETWEEN 1 AND 300000000
    AND lock->>'schema'='infraforge-first-stack-compile-lock/2'
    AND "browserCut"->>'schema'='first-stack-isolated-cut/1'
    AND "browserCut"->>'source'=engine->>'source' AND "browserCut"->>'inputHash'="inputHash"
    AND "browserCut"->'cut'->'lock'=lock AND lineage->>'kind'='design'
    AND envelope->>'revision'='first-stack-submission/1'
    AND workload->>'identity'=lock->>'workloadIdentity'
  ) IS TRUE)
);
CREATE UNIQUE INDEX "FirstStackRun_ownerId_idempotencyKey_key" ON "FirstStackRun"("ownerId","idempotencyKey");
CREATE INDEX "FirstStackRun_ownerId_createdAt_idx" ON "FirstStackRun"("ownerId","createdAt");
CREATE TABLE "FirstStackWork" (
  "runId" TEXT PRIMARY KEY REFERENCES "FirstStackRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', token TEXT, "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  authorized BOOLEAN NOT NULL DEFAULT true, "captureBytes" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT first_stack_work CHECK (status IN ('queued','running','recovery','terminal') AND "captureBytes" BETWEEN 0 AND 33554432
    AND (status NOT IN ('running','recovery') OR token IS NOT NULL))
);
CREATE INDEX "FirstStackWork_status_idx" ON "FirstStackWork"(status);
CREATE TABLE "FirstStackCut" (
  "runId" TEXT NOT NULL REFERENCES "FirstStackRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sequence INTEGER NOT NULL, body JSONB NOT NULL, PRIMARY KEY ("runId",sequence),
  CONSTRAINT first_stack_cut CHECK ((sequence BETWEEN 1 AND 4096 AND body->>'schema'='first-stack-isolated-cut/1'
    AND (body->'cut'->>'sequence')::integer=sequence AND octet_length(body::text)<=2097152
    AND (body->'cut'->>'throughUs')::bigint BETWEEN 0 AND 300000000) IS TRUE)
);
CREATE TABLE "FirstStackResult" (
  "runId" TEXT PRIMARY KEY REFERENCES "FirstStackRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  body JSONB NOT NULL, hash VARCHAR(64) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT first_stack_result CHECK ((hash ~ '^[a-f0-9]{64}$' AND octet_length(body::text)<=33554432
    AND body->>'verification' IN ('unverified','verified','mismatch','interrupted','cancelled','unavailable')) IS TRUE)
);
CREATE TABLE "FirstStackOutbox" (
  "runId" TEXT PRIMARY KEY REFERENCES "FirstStackRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  delivered BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION immutable_first_stack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'First-stack submitted inputs and evidence are append-only';
END;
$$;
CREATE TRIGGER first_stack_run_immutable BEFORE UPDATE OR DELETE ON "FirstStackRun" FOR EACH ROW EXECUTE FUNCTION immutable_first_stack();
CREATE TRIGGER first_stack_cut_immutable BEFORE UPDATE OR DELETE ON "FirstStackCut" FOR EACH ROW EXECUTE FUNCTION immutable_first_stack();
CREATE TRIGGER first_stack_result_immutable BEFORE UPDATE OR DELETE ON "FirstStackResult" FOR EACH ROW EXECUTE FUNCTION immutable_first_stack();

CREATE FUNCTION protect_first_stack_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'First-stack reservation cannot be deleted'; END IF;
  IF OLD.status='terminal' OR NEW."runId"<>OLD."runId" OR NEW."captureBytes"<OLD."captureBytes"
    OR (OLD.token IS NOT NULL AND NEW.token IS DISTINCT FROM OLD.token)
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
CREATE TRIGGER first_stack_work_guard BEFORE UPDATE OR DELETE ON "FirstStackWork" FOR EACH ROW EXECUTE FUNCTION protect_first_stack_work();

CREATE FUNCTION capture_first_stack_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w "FirstStackWork"; r "FirstStackRun"; used INTEGER; previous INTEGER;
BEGIN
  SELECT * INTO w FROM "FirstStackWork" WHERE "runId"=NEW."runId" FOR UPDATE;
  SELECT * INTO r FROM "FirstStackRun" WHERE id=NEW."runId";
  IF w."runId" IS NULL OR (w.status NOT IN ('queued','running') AND NOT (TG_TABLE_NAME='FirstStackResult' AND w.status='terminal' AND r.purpose='private')) THEN
    RAISE EXCEPTION 'First-stack evidence ownership unavailable';
  END IF;
  used := octet_length(NEW.body::text);
  IF TG_TABLE_NAME='FirstStackCut' THEN
    SELECT COALESCE(max(sequence),0) INTO previous FROM "FirstStackCut" WHERE "runId"=NEW."runId";
    IF w.status<>'running' OR w."cancelRequested" OR NOT w.authorized OR NEW.sequence<>previous+1
      OR NEW.body->>'source' IS DISTINCT FROM r.engine->>'source' OR NEW.body->>'inputHash' IS DISTINCT FROM r."inputHash"
      OR NEW.body->'cut'->'lock' IS DISTINCT FROM r.lock THEN RAISE EXCEPTION 'Invalid first-stack cut fence or identity'; END IF;
  ELSE
    IF NEW.body->>'verification'='verified' AND (w.status<>'running' OR w."cancelRequested" OR NOT w.authorized
      OR NEW.body->'receipt'->>'cleanup' IS DISTINCT FROM 'removed'
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
CREATE TRIGGER first_stack_cut_capture BEFORE INSERT ON "FirstStackCut" FOR EACH ROW EXECUTE FUNCTION capture_first_stack_evidence();
CREATE TRIGGER first_stack_result_capture BEFORE INSERT ON "FirstStackResult" FOR EACH ROW EXECUTE FUNCTION capture_first_stack_evidence();

CREATE FUNCTION require_first_stack_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "FirstStackWork" WHERE "runId"=NEW.id)
    OR (NEW.purpose<>'private' AND NOT EXISTS (SELECT 1 FROM "FirstStackOutbox" WHERE "runId"=NEW.id))
    OR (NEW.purpose='private' AND NOT EXISTS (SELECT 1 FROM "FirstStackResult" WHERE "runId"=NEW.id AND body->>'verification'='unverified')) THEN
    RAISE EXCEPTION 'First-stack admission requires atomic reservation and delivery/result';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER first_stack_admission AFTER INSERT ON "FirstStackRun" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_first_stack_reservation();
