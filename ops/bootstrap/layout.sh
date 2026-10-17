#!/usr/bin/env bash
set -euo pipefail
operator=${1:?existing non-root release operator required}
[[ $EUID == 0 && $operator =~ ^[a-z_][a-z0-9_-]*$ && $operator != root ]] || exit 2
id "$operator" >/dev/null
[[ $(id -u "$operator") != 0 ]] || exit 2
group=$(id -gn "$operator")
# Traversal is needed by Nginx; only the release operator may list/write private state.
for path in /etc/infraforge /var/lib/infraforge /var/lib/infraforge/releases /var/lib/infraforge/acme; do
  [[ ! -L $path ]] || { echo 'Refusing symlinked deployment directory' >&2; exit 1; }
done
install -d -m 0750 -o "$operator" -g "$group" /etc/infraforge
install -d -m 0711 -o root -g root /var/lib/infraforge
install -d -m 0711 -o "$operator" -g "$group" /var/lib/infraforge/releases
install -d -m 0755 -o root -g root /var/lib/infraforge/acme
if [[ ! -f /var/lib/infraforge/releases/accepted.json ]]; then
  # Never remove maintenance or a release lock on re-run.
  runuser -u "$operator" -- sh -c 'umask 077; : >> /var/lib/infraforge/releases/maintenance'
fi
if [[ -e /etc/infraforge/release.env ]]; then
  [[ ! -L /etc/infraforge/release.env && $(stat -c %U /etc/infraforge/release.env) == "$operator" &&
     $(stat -c %a /etc/infraforge/release.env) == 600 ]] || { echo 'Existing release.env must be operator-owned mode 0600' >&2; exit 1; }
fi
