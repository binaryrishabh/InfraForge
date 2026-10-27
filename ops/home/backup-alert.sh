#!/usr/bin/env bash
# Emails the owner when the daily database backup fails (systemd OnFailure of infraforge-backup).
# Sends through Resend with the app's existing sender settings; values never reach argv or the log.
set -euo pipefail
settings=/etc/infraforge/release.env
alert=/etc/infraforge/ops/alert.env   # one line: ALERT_EMAIL=<owner address>
read_value() { sed -n "s/^$1=//p" "$2" | head -n 1; }
to=$(read_value ALERT_EMAIL "$alert")
from=$(read_value TRANSACTIONAL_EMAIL_FROM "$settings")
key=$(read_value RESEND_API_KEY "$settings")
[ -n "$to" ] && [ -n "$from" ] && [ -n "$key" ] || { echo "Backup alert not configured" >&2; exit 1; }
log=$(journalctl -u infraforge-backup.service -n 25 --no-pager -o cat 2>&1 | tail -c 3000)
body=$(FROM="$from" TO="$to" HOST="$(hostname)" LOG="$log" python3 -c 'import json, os
print(json.dumps({"from": os.environ["FROM"], "to": [os.environ["TO"]],
  "subject": "InfraForge backup FAILED on " + os.environ["HOST"],
  "text": "The daily database backup failed. Last log lines:

" + os.environ["LOG"]
          + "

Check: systemctl status infraforge-backup"}))')
# The key goes to curl through a header file on stdin, never on the command line.
printf 'Authorization: Bearer %s\n' "$key" | curl -fsS --max-time 20 -H @- -H 'Content-Type: application/json' \
  -d "$body" https://api.resend.com/emails > /dev/null
echo "Backup failure alert sent"
