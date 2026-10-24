CREATE TABLE "AccountMailIntent" (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('signup','reset','verify')),
  "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','sending','sent','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "retrySafe" BOOLEAN NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CHECK ((status IN ('sent','uncertain') AND payload IS NULL)
    OR (status IN ('pending','ready','sending') AND payload IS NOT NULL))
);
CREATE INDEX "AccountMailIntent_availableAt_idx" ON "AccountMailIntent"("availableAt");
CREATE INDEX "AccountMailIntent_expiresAt_idx" ON "AccountMailIntent"("expiresAt");
CREATE INDEX "AccountMailIntent_userId_idx" ON "AccountMailIntent"("userId");
