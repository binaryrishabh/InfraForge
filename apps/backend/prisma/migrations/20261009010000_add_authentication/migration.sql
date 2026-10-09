CREATE TABLE "User" (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false, image TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "User_email_key" ON "User"(email);
CREATE TABLE "Session" (
  id TEXT PRIMARY KEY, token TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_token_key" ON "Session"(token);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE TABLE "Account" (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMP(3), "refreshTokenExpiresAt" TIMESTAMP(3), scope TEXT, password TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");
CREATE TABLE "Verification" (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Verification_identifier_idx" ON "Verification"(identifier);

-- Preserve the historical userId verbatim. A NULL verified owner quarantines all
-- existing designs without guessing their identity from a browser-local account.
ALTER TABLE "Infrastructure" ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Infrastructure" ADD COLUMN "ownerId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Infrastructure_ownerId_idx" ON "Infrastructure"("ownerId");

CREATE FUNCTION protect_design_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN
    IF OLD."ownerId" IS NOT NULL OR EXISTS (
      SELECT 1 FROM "Deployment" WHERE "infrastructureId" = OLD.id
        AND (status IN ('pending', 'running', 'live') OR "runtimeActive")
    ) THEN
      RAISE EXCEPTION 'Ownership recovery requires an unassigned design with no active runs';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER design_owner_guard BEFORE UPDATE OF "ownerId" ON "Infrastructure"
  FOR EACH ROW EXECUTE FUNCTION protect_design_owner();
