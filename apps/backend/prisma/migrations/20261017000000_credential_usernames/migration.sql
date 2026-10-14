BEGIN;

-- No invented identifiers: OAuth and historical users retain NULL usernames.
ALTER TABLE "User" ADD COLUMN "username" VARCHAR(30);
ALTER TABLE "User" ADD CONSTRAINT "User_username_format" CHECK (
  "username" IS NULL OR "username" ~ '^[a-z][a-z0-9_]{2,29}$'
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Better Auth normalizes new emails to lowercase. Protect against races and
-- historical mixed-case collisions without rewriting or merging any account.
-- A conflicting legacy database must be resolved explicitly before migration.
CREATE UNIQUE INDEX "User_email_casefold_key" ON "User"(lower("email"));

COMMIT;
