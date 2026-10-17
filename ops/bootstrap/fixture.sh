#!/usr/bin/env bash
set -euo pipefail
cd /fixture
useradd -m release
umask 077
bash ops/bootstrap/layout.sh release
test "$(stat -c %a /var/lib/infraforge)" = 711
test "$(stat -c %a /var/lib/infraforge/releases)" = 711
test "$(stat -c %a /etc/infraforge)" = 750
runuser -u release -- sh -c 'umask 077; echo private-fixture > /etc/infraforge/release.env; echo held > /var/lib/infraforge/releases/release.lock'
bash ops/bootstrap/layout.sh release
test "$(cat /var/lib/infraforge/releases/release.lock)" = held
test "$(cat /etc/infraforge/release.env)" = private-fixture
runuser -u www-data -- test -f /var/lib/infraforge/releases/maintenance
if runuser -u www-data -- cat /etc/infraforge/release.env; then exit 1; fi
# A fixture service adapter exercises real nginx validation/reload without a systemd PID 1.
printf '#!/bin/sh\nexec nginx -s reload\n' > /usr/local/bin/systemctl
chmod 0755 /usr/local/bin/systemctl
nginx
bash ops/bootstrap/nginx.sh backend.example.invalid http
ready=false
for ((attempt=0; attempt<20; attempt++)); do
  if [[ $(curl -s -o /dev/null -w '%{http_code}' -H 'Host: backend.example.invalid' http://127.0.0.1/api/auth/providers) == 503 ]]; then ready=true; break; fi
  sleep 0.2
done
test "$ready" = true
mkdir -p /var/lib/infraforge/acme/.well-known/acme-challenge
printf acme > /var/lib/infraforge/acme/.well-known/acme-challenge/proof
chmod -R a+rX /var/lib/infraforge/acme
test "$(curl -fsS -H 'Host: backend.example.invalid' http://127.0.0.1/.well-known/acme-challenge/proof)" = acme
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=backend.example.invalid \
  -addext subjectAltName=DNS:backend.example.invalid -keyout /tmp/key.pem -out /tmp/cert.pem >/dev/null 2>&1
bash ops/bootstrap/nginx.sh backend.example.invalid tls /tmp/cert.pem /tmp/key.pem
bash ops/bootstrap/nginx.sh backend.example.invalid tls /tmp/cert.pem /tmp/key.pem
for path in /api/auth/providers /ws; do
  curl --retry 8 --retry-connrefused --retry-delay 1 --cacert /tmp/cert.pem --resolve backend.example.invalid:443:127.0.0.1 -sS -D /tmp/headers \
    -o /dev/null "https://backend.example.invalid$path"
  grep -q '503 Service' /tmp/headers
  grep -qi '^X-InfraForge-Maintenance: true' /tmp/headers
done
before=$(sha256sum /etc/nginx/sites-available/infraforge)
if bash ops/bootstrap/nginx.sh 'bad;injection' tls /tmp/cert.pem /tmp/key.pem; then exit 1; fi
if bash ops/bootstrap/nginx.sh backend.example.invalid http; then exit 1; fi
if bash ops/bootstrap/nginx.sh backend.example.invalid tls /tmp/missing.pem /tmp/key.pem; then exit 1; fi
printf 'invalid directive;\n' > /etc/nginx/conf.d/broken.conf
if bash ops/bootstrap/nginx.sh backend.example.invalid tls /tmp/cert.pem /tmp/key.pem; then exit 1; fi
rm /etc/nginx/conf.d/broken.conf
test "$(sha256sum /etc/nginx/sites-available/infraforge)" = "$before"
nginx -t
printf '{"fixture":true}\n' > /var/lib/infraforge/releases/accepted.json
chown release:release /var/lib/infraforge/releases/accepted.json
rm /var/lib/infraforge/releases/maintenance
bash ops/bootstrap/layout.sh release
test ! -e /var/lib/infraforge/releases/maintenance
curl --cacert /tmp/cert.pem --resolve backend.example.invalid:443:127.0.0.1 -sS -D /tmp/headers \
  -o /dev/null https://backend.example.invalid/api/auth/providers
grep -qi '^X-InfraForge-Maintenance: false' /tmp/headers
chmod 0644 /etc/infraforge/release.env
if bash ops/bootstrap/layout.sh release; then exit 1; fi
echo 'Bootstrap fixture PASS: repeatable private layout, traversal, HTTP ACME, real TLS maintenance, reload, refusals and configuration rollback.'
