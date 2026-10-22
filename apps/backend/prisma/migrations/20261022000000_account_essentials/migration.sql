BEGIN;

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_deleted_profile" CHECK (
  "deletedAt" IS NULL OR (name = 'Deleted account' AND username IS NULL AND image IS NULL
    AND NOT "emailVerified" AND email ~ '^[a-f0-9-]+@deleted[.]invalid$')
);
CREATE TABLE "AccountEmailToken" (
  hash VARCHAR(64) PRIMARY KEY CHECK (hash ~ '^[a-f0-9]{64}$'),
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3)
);
CREATE INDEX "AccountEmailToken_userId_idx" ON "AccountEmailToken"("userId");
CREATE INDEX "AccountEmailToken_expiresAt_idx" ON "AccountEmailToken"("expiresAt");

-- Serialize new credentials/sessions/owned data with account deletion. No run
-- trigger is replaced or disabled; historical immutable rows stay byte-for-byte.
CREATE FUNCTION require_live_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_id TEXT; removed TIMESTAMP(3);
BEGIN
  IF TG_TABLE_NAME IN ('Session', 'Account') THEN account_id := to_jsonb(NEW)->>'userId';
  ELSE account_id := to_jsonb(NEW)->>'ownerId'; END IF;
  IF account_id IS NULL THEN RETURN NEW; END IF;
  SELECT "deletedAt" INTO removed FROM "User" WHERE id = account_id FOR SHARE;
  IF NOT FOUND OR removed IS NOT NULL THEN RAISE EXCEPTION 'Account unavailable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_live_account BEFORE INSERT OR UPDATE OF "userId" ON "Session" FOR EACH ROW EXECUTE FUNCTION require_live_account();
CREATE TRIGGER credential_live_account BEFORE INSERT OR UPDATE OF "userId" ON "Account" FOR EACH ROW EXECUTE FUNCTION require_live_account();
CREATE TRIGGER design_live_account BEFORE INSERT OR UPDATE OF "ownerId" ON "Infrastructure" FOR EACH ROW EXECUTE FUNCTION require_live_account();
CREATE TRIGGER deployment_live_account BEFORE INSERT OR UPDATE OF "ownerId" ON "Deployment" FOR EACH ROW EXECUTE FUNCTION require_live_account();
CREATE TRIGGER model2_live_account BEFORE INSERT ON "InternalModel2Run" FOR EACH ROW EXECUTE FUNCTION require_live_account();
CREATE TRIGGER first_stack_live_account BEFORE INSERT ON "FirstStackRun" FOR EACH ROW EXECUTE FUNCTION require_live_account();

CREATE FUNCTION protect_deleted_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Deleted accounts cannot be restored'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deleted_account_guard BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_deleted_account();

COMMIT;
