CREATE TABLE "AccountMailOutbox" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  "retrySafe" BOOLEAN NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CHECK ((status IN ('sent','uncertain') AND payload IS NULL) OR (status IN ('pending','sending') AND payload IS NOT NULL))
);
CREATE INDEX "AccountMailOutbox_availableAt_idx" ON "AccountMailOutbox"("availableAt");
CREATE INDEX "AccountMailOutbox_userId_idx" ON "AccountMailOutbox"("userId");
CREATE INDEX "AccountMailOutbox_expiresAt_idx" ON "AccountMailOutbox"("expiresAt");
