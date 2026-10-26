# Home server production host

InfraForge's backend moves from AWS EC2 to the owner's home server (`backend`, Ubuntu 24.04,
x86_64, reached over Tailscale at `100.75.14.4`). Public traffic arrives only through the
Cloudflare Tunnel `asus-backend`, which forwards to nginx on `127.0.0.1:8080`. The release
process itself is unchanged: the same workflow, approval and `scripts/deploy/backend.ts`.

## Already done on the host (2026-10-26)

- Docker CE with the classic `overlay2` store ([ops/home/docker-daemon.json](../ops/home/docker-daemon.json)),
  so the release disk preflight takes its verified overlay2 path. Compose, Buildx, Bun 1.3.14.
- `ops/bootstrap/host.sh ubuntu` (its last step, the certbot renew hook, is not used here).
- nginx gateway shared by all projects on this host:
  [ops/home/nginx-gateway.conf](../ops/home/nginx-gateway.conf) answers 404 for unclaimed hostnames.
  Each project adds its own `sites-available` file with `listen 127.0.0.1:8080; server_name <host>;`.
- InfraForge's site: [ops/home/nginx-infraforge-backend.conf](../ops/home/nginx-infraforge-backend.conf),
  derived from `ops/nginx.conf.template`. TLS ends at Cloudflare; the visitor address comes from
  `CF-Connecting-IP` and is trusted only from the local tunnel.
- `/etc/infraforge`, `/var/lib/infraforge/releases` (with the maintenance marker) and `~/InfraForge`.

## Owner steps

1. **Cloudflare** → Zero Trust → Networks → Tunnels → `asus-backend` → Public hostnames → add
   `infraforge-backend.lapwork.in` → `http://127.0.0.1:8080`. (Cloudflare's free certificate covers
   one subdomain level, so the old `infraforge.backend.lapwork.in` cannot use the tunnel.)
2. **Secrets file.** Copy EC2's file to the home server without displaying it; it carries the sign-in,
   email and captcha keys. From PowerShell:

   ```powershell
   ssh <ec2-user>@<ec2-host> "sudo cat /etc/infraforge/release.env" | ssh -i "$env:USERPROFILE\.ssh\asus_backend_ed25519" ubuntu@100.75.14.4 "umask 077; cat > /etc/infraforge/release.env"
   ```

   Then point it at the new hostname (prints nothing):

   ```powershell
   ssh -i "$env:USERPROFILE\.ssh\asus_backend_ed25519" ubuntu@100.75.14.4 "sed -i 's#^BETTER_AUTH_URL=.*#BETTER_AUTH_URL=https://infraforge-backend.lapwork.in#' /etc/infraforge/release.env && stat -c '%U %a' /etc/infraforge/release.env"
   ```

   It must report `ubuntu 600`.
3. **Sign-in callbacks.** Add the new callback URLs (keep the old ones until EC2 is retired):
   - Google: `https://infraforge-backend.lapwork.in/api/auth/callback/google`
   - GitHub: `https://infraforge-backend.lapwork.in/api/auth/callback/github`
4. **Tailscale for GitHub Actions.** In the Tailscale admin: add tag `tag:infraforge-ci` (owner: you),
   allow it to reach `100.75.14.4:22` only, and create an OAuth client with the `auth_keys` write
   scope for that tag. Save its ID and secret as repository secrets `TS_OAUTH_CLIENT_ID` and
   `TS_OAUTH_SECRET`.
5. **Deploy key.** Make a new key only for GitHub, add its public half to the home server's
   `~/.ssh/authorized_keys`, then repoint the existing release secrets: `EC2_HOST=100.75.14.4`,
   `EC2_USERNAME=ubuntu`, `EC2_SSH_KEY`, and `EC2_HOST_FINGERPRINT` = the host's **ECDSA** key
   (`ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub`); the release SSH client checks ECDSA, so an
   Ed25519 fingerprint fails. Keep the old EC2 values somewhere safe for rollback.
6. **GitHub variables.** `DEPLOY_OVER_TAILSCALE=true` and
   `PRODUCTION_BACKEND_ORIGIN=https://infraforge-backend.lapwork.in`. Change secrets and variables
   *before* a release run is created; a queued run keeps the old values.
7. **Vercel** (Production environment variables): `VITE_BACKEND_API_URL=https://infraforge-backend.lapwork.in/api`
   and `VITE_WS_URL=wss://infraforge-backend.lapwork.in/ws`.

## Cutover

1. A brand-new host starts in maintenance, so the workflow refuses its first release. Run it once over SSH
   from the clean checkout (docs/PRODUCTION_BOOTSTRAP.md "New host"):
   `cd ~/InfraForge && bun --no-env-file scripts/release.ts apply <SHA> /etc/infraforge/release.env /var/lib/infraforge/releases`.
   It builds and starts on the home server, creates a fresh database (the EC2 data was test data
   only and is not moved), clears
   maintenance and checks `https://infraforge-backend.lapwork.in/health/ready`.
2. Re-run the release workflow for the same SHA; it deploys the frontend built against the new
   backend address. Any later change to `/etc/infraforge/release.env` needs a new release (a new
   commit), not a re-run.
3. Users sign in again once (cookies belong to the old hostname).

EC2 keeps running untouched as the fallback.

## Rollback

Restore the old `EC2_*` secrets, set `DEPLOY_OVER_TAILSCALE=false` and
`PRODUCTION_BACKEND_ORIGIN=https://infraforge.backend.lapwork.in`, then approve a release. After a
stable week, EC2 becomes a development instance.

## Another project on this host

Give it its own Compose project, its own loopback ports, its own `/etc/<project>` and
`/var/lib/<project>`, and its own nginx file next to InfraForge's. Add its hostname to the same tunnel.

## Feature flags on the home server (2026-10-26)

- `ACCOUNT_ESSENTIALS_ENABLED=false` and the `TURNSTILE_*` keys are commented out. The web app does
  not yet have the "check your email" screen or the captcha widget, so turning either on blocks
  email signup. Turn them back on only after those screens ship and a real signup is tested.
- Google and GitHub sign-in are on. Email/password signup works without email verification.
