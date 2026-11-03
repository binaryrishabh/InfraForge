#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
umask 077

fail() { echo "$1" >&2; exit 2; }
usage() {
  echo 'Usage: install-backup-alert.sh --email ADDRESS [--dry-run] [--root DIR] [--send-test]'
  echo '       install-backup-alert.sh --uninstall [--dry-run] [--root DIR]'
}
email= root= dry_run=false uninstall=false send_test=false
while (($#)); do
  case $1 in
    --email) (($# >= 2)) || fail '--email requires an address'; email=$2; shift 2 ;;
    --root)
      (($# >= 2)) && [[ -d $2 ]] || fail '--root requires an existing directory'
      root=$(cd -- "$2" && pwd -P)
      [[ $root != / ]] || fail '--root must be a staging directory, not /'
      shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --uninstall) uninstall=true; shift ;;
    --send-test) send_test=true; shift ;;
    --help) usage; exit 0 ;;
    *) fail 'Unknown option; use --help' ;;
  esac
done
if $send_test && { [[ -n $root ]] || $dry_run || $uninstall; }; then
  fail '--send-test requires a real install without --root, --dry-run or --uninstall'
fi
if ! $uninstall; then
  [[ -n $email ]] || fail 'Invalid email: --email ADDRESS is required'
  local_part='[A-Za-z0-9_+%-]+([.][A-Za-z0-9_+%-]+)*'
  label='[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?'
  [[ ${#email} -le 254 && ! $email =~ [[:space:][:cntrl:]] && $email =~ ^${local_part}@${label}([.]${label})+$ ]] ||
    fail 'Invalid email: supply one conservative address (at most 254 characters, no whitespace or unsafe characters)'
fi
[[ -n $root || $EUID == 0 ]] || $dry_run || fail 'Run as root, or use --root for a staged install'

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
script=$root/usr/local/sbin/infraforge-backup-alert
unit=$root/etc/systemd/system/infraforge-backup-alert.service
dropin=$root/etc/systemd/system/infraforge-backup.service.d/10-alert.conf
alert=$root/etc/infraforge/ops/alert.env
settings=$root/etc/infraforge/release.env
hook=$'[Unit]\nOnFailure=infraforge-backup-alert.service'

# Refuse symlinks at every destination component, including during uninstall.
for destination in "$script" "$unit" "$dropin" "$alert"; do
  path=$destination
  while [[ $path != / && $path != . ]]; do
    [[ ! -L $path ]] || fail 'Refusing a symlinked destination'
    path=${path%/*}
    [[ -n $path ]] || path=/
  done
  [[ ! -e $destination || -f $destination ]] || fail 'Destination must be a regular file'
done
if ! $uninstall; then
  [[ -f $settings ]] && grep -q '^TRANSACTIONAL_EMAIL_FROM=' "$settings" &&
    grep -q '^RESEND_API_KEY=' "$settings" ||
    fail 'release.env requires TRANSACTIONAL_EMAIL_FROM and RESEND_API_KEY lines'
  [[ -f $here/backup-alert.sh && -f $here/infraforge-backup-alert.service ]] || fail 'Missing installer source files'
fi

changed=false
owner=$EUID
group=$(id -g)
if [[ $EUID == 0 ]]; then group=0; fi
current_metadata() {
  [[ $(stat -c '%a:%u:%g' -- "$1") == "$2:$owner:$group" ]]
}
write_file() {
  local destination=$1 mode=$2 source=$3 same=false
  if [[ -f $destination ]]; then
    case $source in
      email) cmp -s -- "$destination" <(printf 'ALERT_EMAIL=%s\n' "$email") && same=true ;;
      hook) cmp -s -- "$destination" <(printf '%s\n' "$hook") && same=true ;;
      *) cmp -s -- "$destination" "$source" && same=true ;;
    esac
    if $same && current_metadata "$destination" "$mode"; then return; fi
  fi
  changed=true
  printf 'Install %s (mode %s, owner %s:%s)\n' "$destination" "$mode" "$owner" "$group"
  if $dry_run; then return; fi
  # Do not change permissions or ownership of pre-existing parent directories.
  local parent
  parent=${destination%/*}
  if [[ ! -d $parent ]]; then install -d -m 0755 -- "$parent"; fi
  case $source in
    email)
      # The address reaches only a shell builtin and this file, never another command's argv.
      if [[ ! -e $destination ]]; then install -m 0600 /dev/null "$destination"; fi
      chmod 0600 -- "$destination"
      printf 'ALERT_EMAIL=%s\n' "$email" > "$destination" ;;
    hook) printf '%s\n' "$hook" > "$destination" ;;
    *) install -m "$mode" -- "$source" "$destination" ;;
  esac
  chmod "$mode" -- "$destination"
  if [[ $EUID == 0 ]]; then chown root:root -- "$destination"; fi
}

if $uninstall; then
  for destination in "$script" "$unit" "$dropin" "$alert"; do
    if [[ -e $destination ]]; then
      printf 'Remove %s\n' "$destination"
      changed=true
      if ! $dry_run; then rm -- "$destination"; fi
    fi
  done
else
  domain=${email#*@}
  printf 'Recipient: %s***@%s***.%s\n' "${email:0:1}" "${domain:0:1}" "${domain##*.}"
  write_file "$alert" 600 email
  write_file "$script" 755 "$here/backup-alert.sh"
  write_file "$unit" 644 "$here/infraforge-backup-alert.service"
  write_file "$dropin" 644 hook
fi
if ! $changed; then echo 'No changes; already current'; fi
if [[ -n $root ]]; then
  echo 'Staged install: systemctl skipped'
elif $dry_run; then
  if $changed; then echo 'Would run: systemctl daemon-reload'; fi
  if ! $uninstall; then echo 'Would verify: systemctl cat infraforge-backup.service (effective OnFailure)'; fi
else
  if $changed; then systemctl daemon-reload; fi
  if ! $uninstall; then
    # Check the merged unit plus drop-ins and the manager's effective value; do not log unit contents.
    systemctl cat infraforge-backup.service | grep '^OnFailure=.*infraforge-backup-alert.service' >/dev/null
    effective=$(systemctl show infraforge-backup.service --property=OnFailure --value)
    [[ " $effective " == *' infraforge-backup-alert.service '* ]] || fail 'Effective OnFailure verification failed'
    echo 'Verified effective OnFailure=infraforge-backup-alert.service'
  fi
  if $send_test; then
    systemctl start infraforge-backup-alert.service
    echo 'Test alert requested once; check the chosen inbox'
  fi
fi
