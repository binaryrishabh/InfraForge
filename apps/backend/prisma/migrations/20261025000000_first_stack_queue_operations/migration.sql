-- Operational counters only. Durable user inputs/evidence and all guards remain unchanged.
CREATE TABLE "FirstStackQueueEvent" (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('failed','stalled','reconciled')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "FirstStackQueueEvent_createdAt_idx" ON "FirstStackQueueEvent"("createdAt");
-- NULL means the historical delivery time is unknown; never backfill an invented time.
ALTER TABLE "FirstStackOutbox" ADD COLUMN "deliveredAt" TIMESTAMPTZ(3);
ALTER TABLE "FirstStackReplay" ADD COLUMN "deliveredAt" TIMESTAMPTZ(3);

-- Preserve the original total capture ceiling and reserve 4 KiB for an offline
-- interrupted result. Serial cuts/full hidden audit cannot strand new work by
-- exhausting every byte needed to record reviewed cleanup.
CREATE FUNCTION reserve_first_stack_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w "FirstStackWork";
BEGIN
  SELECT * INTO w FROM "FirstStackWork" WHERE "runId"=NEW."runId" FOR UPDATE;
  IF w.status IN ('queued','running') AND w."captureBytes"+octet_length(NEW.body::text)>33550336 THEN
    RAISE EXCEPTION 'First-stack evidence must preserve recovery receipt capacity';
  END IF;
  RETURN NEW;
END;
$$;
-- Alphabetical order is intentional: these run before the existing capture guards.
CREATE TRIGGER first_stack_00_recovery_cut BEFORE INSERT ON "FirstStackCut" FOR EACH ROW EXECUTE FUNCTION reserve_first_stack_recovery();
CREATE TRIGGER first_stack_00_recovery_result BEFORE INSERT ON "FirstStackResult" FOR EACH ROW EXECUTE FUNCTION reserve_first_stack_recovery();
