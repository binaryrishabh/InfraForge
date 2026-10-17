#!/usr/bin/env bash
set -euo pipefail
domain=${1:?backend DNS name required}
mode=${2:?http or tls required}
cert=${3:-}
key=${4:-}
[[ $EUID == 0 ]] || exit 2
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
work=$(mktemp -d)
installed=false
committed=false
cleanup() {
  if [[ $installed == true && $committed == false ]]; then restore; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bun --no-env-file "$here/render.ts" "$domain" "$mode" "$cert" "$key" > "$work/site"
if [[ $mode == tls ]]; then
  test -r "$cert" && test -r "$key"
  openssl verify -purpose sslserver -verify_hostname "$domain" -untrusted "$cert" "$cert"
  openssl x509 -in "$cert" -noout -checkend 86400
  test "$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)" = \
       "$(openssl pkey -in "$key" -pubout -outform DER | sha256sum)"
fi
site=/etc/nginx/sites-available/infraforge
link=/etc/nginx/sites-enabled/infraforge
[[ ! -L $site ]] || { echo 'Refusing symlinked site file' >&2; exit 1; }
if [[ -e $site ]]; then
  grep -qx '# InfraForge managed site' "$site" || { echo 'Existing unmanaged site: review/adopt explicitly before installation' >&2; exit 1; }
  cp -p "$site" "$work/previous"
  # A rerun must not silently downgrade a TLS host to HTTP-only maintenance.
  if [[ $mode == http ]] && grep -q 'listen 443 ssl' "$site"; then echo 'TLS downgrade refused' >&2; exit 1; fi
fi
[[ ! -e $link && ! -L $link || $(readlink "$link") == "$site" ]] || { echo 'Existing enabled site conflicts' >&2; exit 1; }
had_link=false
[[ ! -L $link ]] || had_link=true
restore() {
  if [[ -e $work/previous ]]; then cp -p "$work/previous" "$site"; else rm -f -- "$site"; fi
  if [[ $had_link == false ]]; then rm -f -- "$link"; fi
}
installed=true
install -m 0644 "$work/site" "$site"
ln -sfn "$site" "$link"
if ! nginx -t; then restore; exit 1; fi
if ! systemctl reload-or-restart nginx; then restore; nginx -t && systemctl reload-or-restart nginx; exit 1; fi
committed=true
echo 'InfraForge site validated and reloaded; unrelated sites preserved.'
