# PostgreSQL backup and restore verification

These Linux scripts use PostgreSQL 18 client tools and GNU coreutils. They do
not install a schedule, contact a production host or provision storage.

1. An operator chooses an encrypted backup filesystem and creates a directory
   owned by the backup account with mode 0700. Supply libpq connection settings
   through the operator's existing service/pgpass configuration, using a backup
   role with read access to every application schema. Keep pgpass mode 0600;
   use certificate-verified TLS for a remote source. Do not put URLs/passwords in
   command arguments or log them. The scripts do not load environment files.
2. Run `bash ops/bootstrap/postgres-backup.sh /absolute/private/backup-directory`.
   A unique private directory receives a custom-format archive, checksum and
   private diagnostic. Only `BACKUP PASS` and a completed SHA256SUMS receipt
   indicate success. Incomplete directories have no usable receipt; preserve
   them privately for diagnosis. Rerunning creates a new backup, never overwrites
   an earlier one. Binary archive checksums must remain byte exact.
3. Copy a completed backup to a separate disposable local PostgreSQL 18 instance
   with sufficient disk space. Its local role needs CREATEDB and table ownership
   only there. Run
   `RESTORE_DISPOSABLE=local-only bash ops/bootstrap/postgres-restore-verify.sh /private/copied-backup 55432 local_restore_role`.
   The script verifies checksum, creates a random new database from template0,
   restores atomically, reads every application table, and drops only the database
   it successfully created. It refuses remote hosts, supplied destination names,
   absent acknowledgement, malformed checksums and symlink archives. It clears
   source libpq settings, disables password prompting and uses fixed loopback.
   A cleanup error exits nonzero and requires local operator cleanup.
4. Record elapsed backup/restore time, bytes, checksum and exit status in private
   operations records. Verify application login and old/new run reports in an
   isolated release rehearsal before declaring an application recovery drill
   complete. `scripts/release/backup.ts` already provides `proveRestore` for a
   fenced source with full schema/history/count/content comparison; the existing
   release rehearsals exercise that stronger offline comparison. A successful
   online dump/restore alone does not establish application RTO or source equality
   while writes continue.

Both commands have bounded connection, lock and subprocess waits; the ten-minute
overall budget is an initial policy to review against measured database size.
There are no automatic retries or retention deletion. Back up before migrations;
keep the matching immutable release image/source. A custom dump omits cluster
roles and provider settings. Provision restore roles separately; never recover by
overwriting the only source database. This procedure does not supply WAL/PITR.

Recommended pending owner approval: daily encrypted off-host backups, 7 daily
and 4 weekly copies, backup-age/failure alerts, and monthly restore drills. The
cadence, retention, storage budget, RPO/RTO and provider-managed PITR remain open
decisions. No schedule or remote storage has been configured.

The disposable regression is `BACKUP_PROOF_DISPOSABLE=owned-container bash
ops/bootstrap/postgres-backup-proof.sh` inside a fresh `postgres:18`
container. It creates fixture-only databases; never run it on an existing server.
