CREATE TABLE "InternalModel2Grant" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  reason VARCHAR(400) NOT NULL CHECK (length(trim(reason)) > 0),
  "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
-- Empty by default. Internal authorization is an operator grant, never a client hash.
CREATE TABLE "InternalModel2Run" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "infrastructureId" TEXT REFERENCES "Infrastructure"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  "idempotencyKey" VARCHAR(80) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  input JSONB NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  token TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  "throughUs" INTEGER NOT NULL DEFAULT 0,
  evidence JSONB,
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  reason VARCHAR(500),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT internal_model2_state CHECK (status IN ('queued','running','completed','failed','interrupted','cancelled') AND sequence BETWEEN 0 AND 32 AND "throughUs" BETWEEN 0 AND 1000000),
  CONSTRAINT internal_model2_bytes CHECK (octet_length(input::text) <= 786432 AND (evidence IS NULL OR octet_length(evidence::text) <= 393216)),
  CONSTRAINT internal_model2_identity CHECK ("inputHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$' AND "idempotencyKey" ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT internal_model2_evidence CHECK ((sequence = 0 AND evidence IS NULL AND "throughUs" = 0) OR (sequence > 0 AND evidence IS NOT NULL)),
  CONSTRAINT internal_model2_terminal CHECK ((status = 'queued' AND token IS NULL AND sequence = 0) OR (status <> 'queued' AND (status IN ('cancelled','failed') OR token IS NOT NULL))),
  CONSTRAINT internal_model2_complete CHECK (status <> 'completed' OR evidence IS NOT NULL)
);
CREATE UNIQUE INDEX "InternalModel2Run_ownerId_idempotencyKey_key" ON "InternalModel2Run"("ownerId", "idempotencyKey");
CREATE INDEX "InternalModel2Run_status_createdAt_idx" ON "InternalModel2Run"(status, "createdAt");
CREATE FUNCTION protect_internal_model2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The exact-source trigger also enforces bounds if a CHECK is altered. Release
  -- postchecks verify this function and the validated constraint inventory.
  IF TG_OP <> 'DELETE' THEN
    IF NEW.status NOT IN ('queued','running','completed','failed','interrupted','cancelled') OR
       NEW.sequence NOT BETWEEN 0 AND 32 OR NEW."throughUs" NOT BETWEEN 0 AND 1000000 OR
       octet_length(NEW.input::text) > 786432 OR (NEW.evidence IS NOT NULL AND octet_length(NEW.evidence::text) > 393216) OR
       NEW."inputHash" !~ '^[a-f0-9]{64}$' OR NEW."requestHash" !~ '^[a-f0-9]{64}$' OR NEW."idempotencyKey" !~ '^[A-Za-z0-9_-]{1,80}$' OR
       NOT ((NEW.sequence=0 AND NEW.evidence IS NULL AND NEW."throughUs"=0) OR (NEW.sequence>0 AND NEW.evidence IS NOT NULL)) OR
       NOT ((NEW.status='queued' AND NEW.token IS NULL AND NEW.sequence=0) OR (NEW.status<>'queued' AND (NEW.status IN ('cancelled','failed') OR NEW.token IS NOT NULL))) OR
       (NEW.status='completed' AND NEW.evidence IS NULL) THEN RAISE EXCEPTION 'Internal Model-2 state or persistence budget invalid'; END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'queued' OR NEW.token IS NOT NULL OR NEW.evidence IS NOT NULL THEN RAISE EXCEPTION 'Internal Model-2 admission must be queued'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "InternalModel2Grant" WHERE "userId" = NEW."ownerId") OR
       NOT EXISTS (SELECT 1 FROM "Infrastructure" WHERE id = NEW."infrastructureId" AND "ownerId" = NEW."ownerId") THEN
      RAISE EXCEPTION 'Internal Model-2 requires granted same-owner design';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('queued','running') THEN RAISE EXCEPTION 'Active internal run cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id,NEW."ownerId",NEW."idempotencyKey",NEW."requestHash",NEW.input,NEW."inputHash",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."ownerId",OLD."idempotencyKey",OLD."requestHash",OLD.input,OLD."inputHash",OLD."createdAt") THEN
    RAISE EXCEPTION 'Internal execution inputs and owner are immutable';
  END IF;
  IF NEW."infrastructureId" IS DISTINCT FROM OLD."infrastructureId" AND NOT (OLD."infrastructureId" IS NOT NULL AND NEW."infrastructureId" IS NULL) THEN
    RAISE EXCEPTION 'Internal saved-design reference is immutable';
  END IF;
  IF OLD.status NOT IN ('queued','running') AND (to_jsonb(NEW) - 'infrastructureId') IS DISTINCT FROM (to_jsonb(OLD) - 'infrastructureId') THEN
    RAISE EXCEPTION 'Terminal internal run is immutable';
  END IF;
  IF (OLD.status = 'queued' AND NEW.status NOT IN ('queued','running','cancelled','failed')) OR
     (OLD.status = 'running' AND NEW.status = 'queued') OR
     (OLD.token IS NOT NULL AND NEW.token IS DISTINCT FROM OLD.token) OR
     NEW.sequence < OLD.sequence OR NEW.sequence > OLD.sequence + 1 OR NEW."throughUs" < OLD."throughUs" OR
     (NEW.evidence IS DISTINCT FROM OLD.evidence AND NEW.sequence <> OLD.sequence + 1) OR
     (NEW."throughUs" <> OLD."throughUs" AND NEW.evidence IS NOT DISTINCT FROM OLD.evidence) OR
     (NEW.sequence <> OLD.sequence AND NEW.evidence IS NOT DISTINCT FROM OLD.evidence) OR
     (OLD."cancelRequested" AND NOT NEW."cancelRequested") THEN
    RAISE EXCEPTION 'Invalid internal execution transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER internal_model2_guard BEFORE INSERT OR UPDATE OR DELETE ON "InternalModel2Run" FOR EACH ROW EXECUTE FUNCTION protect_internal_model2();
