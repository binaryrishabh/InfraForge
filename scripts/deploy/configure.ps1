param([switch]$Enable, [string]$BackendOrigin = 'https://infraforge.backend.lapwork.in', [string]$FrontendOrigin = 'https://infraforge.lapwork.in')
$ErrorActionPreference = 'Stop'
$repo = 'binaryrishabh/InfraForge'
function Check-Native { if ($LASTEXITCODE -ne 0) { throw 'Hosted setup command failed; releases remain disabled.' } }
if (-not $Enable) { throw 'Use -Enable after reviewing docs/PRODUCTION_BOOTSTRAP.md. This configures hosted release access and dispatches the first gated release.' }
foreach ($origin in @($BackendOrigin, $FrontendOrigin)) {
  $uri = [uri]$origin
  if ($uri.Scheme -ne 'https' -or $uri.GetLeftPart([UriPartial]::Authority) -ne $origin -or $uri.UserInfo) { throw 'Exact HTTPS origins required' }
}
gh variable set PRODUCTION_RELEASE_ENABLED --repo $repo --body false
Check-Native
$sha = gh api "repos/$repo/commits/main" --jq .sha
Check-Native
$runs = gh api "repos/$repo/actions/workflows/validate.yml/runs?branch=main&event=push&head_sha=$sha&per_page=1" | ConvertFrom-Json
Check-Native
if ($runs.workflow_runs.Count -ne 1 -or $runs.workflow_runs[0].conclusion -ne 'success' -or $runs.workflow_runs[0].head_sha -ne $sha) { throw 'Current main needs successful exact-SHA push CI first.' }
$environment = gh api "repos/$repo/environments/Production" | ConvertFrom-Json
Check-Native
$policies = gh api "repos/$repo/environments/Production/deployment-branch-policies" | ConvertFrom-Json
Check-Native
if ($environment.can_admins_bypass -ne $false -or $environment.deployment_branch_policy.custom_branch_policies -ne $true -or
    $policies.branch_policies.Count -ne 1 -or $policies.branch_policies[0].name -ne 'main' -or $policies.branch_policies[0].type -ne 'branch') { throw 'Production must retain no admin bypass and main-only deployment.' }
$names = gh secret list --repo $repo --json name | ConvertFrom-Json
Check-Native
foreach ($name in @('EC2_HOST','EC2_USERNAME','EC2_SSH_KEY')) { if ($name -notin $names.name) { throw "Missing existing repository secret: $name" } }
Write-Host 'Enter the independently verified EC2 SHA256 host fingerprint at the hidden GitHub prompt.'
gh secret set EC2_HOST_FINGERPRINT --repo $repo --env Production
Check-Native
Write-Host 'Enter a Vercel token with access to the production project at the hidden GitHub prompt. Do not paste it into chat.'
gh secret set VERCEL_TOKEN --repo $repo --env Production
Check-Native
foreach ($name in @('VERCEL_ORG_ID','VERCEL_PROJECT_ID')) {
  $value = Read-Host "$name (non-secret, from Vercel project settings)"
  if ($value -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid project/team ID' }
  gh variable set $name --repo $repo --env Production --body $value
  Check-Native
}
foreach ($setting in @(@('PRODUCTION_BACKEND_ORIGIN',$BackendOrigin),@('PRODUCTION_FRONTEND_ORIGIN',$FrontendOrigin))) {
  gh variable set $setting[0] --repo $repo --env Production --body $setting[1]
  Check-Native
}
$names = gh secret list --repo $repo --env Production --json name | ConvertFrom-Json
Check-Native
foreach ($name in @('EC2_HOST_FINGERPRINT','VERCEL_TOKEN')) { if ($name -notin $names.name) { throw "Missing Production secret: $name" } }
gh variable set PRODUCTION_RELEASE_ENABLED --repo $repo --body true
Check-Native
gh workflow run deploy.yml --repo $repo --ref main -f "release_sha=$sha"
if ($LASTEXITCODE -ne 0) {
  gh variable set PRODUCTION_RELEASE_ENABLED --repo $repo --body false
  throw 'Dispatch failed; automatic releases disabled again.'
}
Write-Host "Release $sha dispatched. Review the Production environment approval in GitHub Actions. No EC2 terminal step is required."
