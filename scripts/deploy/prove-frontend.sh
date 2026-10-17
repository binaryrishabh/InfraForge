#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
trap 'rm -rf -- "$work"; rm -f /tmp/infraforge-production-release.json' EXIT
mkdir "$work/bin"
export PROOF_EVENTS="$work/events"
export RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export BACKEND_ORIGIN=https://backend.example.invalid FRONTEND_ORIGIN=https://app.example.invalid
export VERCEL_TOKEN=fixture-only VERCEL_ORG_ID=team_fixture VERCEL_PROJECT_ID=prj_fixture
cat > "$work/bin/git" <<'SCRIPT'
#!/usr/bin/env bash
if [[ $1 == rev-parse ]]; then printf '%s\n' "$RELEASE_SHA"; fi
SCRIPT
cat > "$work/bin/vercel" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$1" >> "$PROOF_EVENTS"
case $1 in
  deploy) [[ $* == *--prod* && $* == *--skip-domain* ]] || exit 1; echo https://fixture-123.vercel.app ;;
  curl) [[ $PROOF_FAILURE != protected-read ]] ;;
  promote) [[ $PROOF_FAILURE != promotion ]] ;;
  *) exit 1 ;;
esac
SCRIPT
cat > "$work/bin/bun" <<'SCRIPT'
#!/usr/bin/env bash
printf 'check\n' >> "$PROOF_EVENTS"
[[ $PROOF_FAILURE != identity ]]
SCRIPT
chmod 0755 "$work/bin/"*
export PATH="$work/bin:$PATH"
for failure in none protected-read identity promotion; do
  export PROOF_FAILURE=$failure
  : > "$PROOF_EVENTS"
  if bash "$root/scripts/deploy/frontend.sh"; then
    [[ $failure == none ]] || exit 1
    [[ $(paste -sd, "$PROOF_EVENTS") == deploy,curl,check,promote,check ]] || exit 1
  else
    [[ $failure != none ]] || exit 1
    if [[ $failure != promotion ]] && grep -q promote "$PROOF_EVENTS"; then exit 1; fi
  fi
done
echo 'Frontend command sequencing PASS: production staging, protected read, identity, promotion, final check; refusal before promotion on failed prerequisites.'
