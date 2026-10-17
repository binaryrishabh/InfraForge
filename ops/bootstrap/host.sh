#!/usr/bin/env bash
set -euo pipefail
operator=${1:?existing non-root release operator required}
[[ $EUID == 0 && $operator =~ ^[a-z_][a-z0-9_-]*$ && $operator != root ]] || exit 2
id "$operator" >/dev/null
[[ $(id -u "$operator") != 0 ]] || exit 2
# This deliberately supports one maintained host family, rather than guessing other distributions.
# shellcheck source=/dev/null
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || { echo 'Requires Ubuntu 24.04 LTS' >&2; exit 1; }
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
new_nginx=false
command -v nginx >/dev/null || new_nginx=true
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl git unzip nginx certbot openssl
if ! command -v docker >/dev/null; then
  for package in docker.io docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      echo 'Conflicting container packages: review before bootstrap; nothing is removed automatically' >&2; exit 1
    fi
  done
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  [[ ! -e /etc/apt/sources.list.d/docker.sources ]] || { echo 'Review existing Docker apt source' >&2; exit 1; }
  printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: noble\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources
  chmod 0644 /etc/apt/sources.list.d/docker.sources
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
docker compose version >/dev/null
docker buildx version >/dev/null
systemctl enable --now docker
systemctl enable nginx
if [[ $new_nginx == true ]]; then
  systemctl stop nginx
  # A new host stays closed until its explicit domain/ACME site passes validation.
  if [[ -L /etc/nginx/sites-enabled/default && $(readlink /etc/nginx/sites-enabled/default) == /etc/nginx/sites-available/default ]]; then
    rm /etc/nginx/sites-enabled/default
  fi
fi
usermod -aG docker "$operator"
if command -v bun >/dev/null; then
  [[ $(bun --version) == 1.3.14 ]] || { echo 'Existing Bun must be reviewed; required version is 1.3.14' >&2; exit 1; }
else
  case $(uname -m) in
    x86_64) archive=bun-linux-x64; checksum=951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f ;;
    aarch64) archive=bun-linux-aarch64; checksum=a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b ;;
    *) echo 'Unsupported Bun host architecture' >&2; exit 1 ;;
  esac
  work=$(mktemp -d)
  trap 'rm -rf -- "$work"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/$archive.zip" -o "$work/bun.zip"
  printf '%s  %s\n' "$checksum" "$work/bun.zip" | sha256sum --check --status
  unzip -q "$work/bun.zip" -d "$work"
  install -m 0755 "$work/$archive/bun" /usr/local/bin/bun
fi
test "$(bun --version)" = 1.3.14
bash "$here/layout.sh" "$operator"
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
hook=/etc/letsencrypt/renewal-hooks/deploy/infraforge-nginx
if [[ -e $hook ]] && ! cmp -s "$here/renew-nginx.sh" "$hook"; then
  echo 'Existing InfraForge renewal hook differs; review before replacing' >&2; exit 1
fi
install -m 0755 "$here/renew-nginx.sh" "$hook"
echo 'Host pieces ready. Reconnect the operator to acquire Docker group membership. Configure private release.env, DNS and TLS per the runbook.'
