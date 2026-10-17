$ErrorActionPreference = 'Stop'
$fixtureSha = 'a' * 40
function Read-Host { 'fixture_id' }
function gh {
  $call = @($args | ForEach-Object { [string]$_ })
  $global:LASTEXITCODE = 0
  $global:InfraForgeSetupEvents.Add(($call -join ' '))
  if ($call[0] -eq 'api') {
    if ($call[1] -like '*/commits/main') { return $fixtureSha }
    if ($call[1] -like '*/actions/workflows/*') { return (@{workflow_runs=@(@{conclusion=$(if($scenario -eq 'ci'){ 'failure' } else { 'success' });head_sha=$fixtureSha})} | ConvertTo-Json -Depth 6) }
    if ($call[1] -like '*/deployment-branch-policies') { return '{"branch_policies":[{"name":"main","type":"branch"}]}' }
    return (@{can_admins_bypass=($scenario -eq 'bypass');deployment_branch_policy=@{custom_branch_policies=$true};protection_rules=@(@{type='required_reviewers';reviewers=@(@{id=1})})} | ConvertTo-Json -Depth 6)
  }
  if ($call[0] -eq 'secret' -and $call[1] -eq 'list') {
    $names = if ($call -contains 'Production') { @('EC2_HOST_FINGERPRINT','VERCEL_TOKEN') } else { @('EC2_HOST','EC2_USERNAME','EC2_SSH_KEY') }
    if ($scenario -eq 'missing') { $names=@() }
    return (ConvertTo-Json -InputObject @($names | ForEach-Object { @{name=$_} }))
  }
  if ($call[0] -eq 'workflow' -and $scenario -eq 'dispatch') { $global:LASTEXITCODE=1 }
}
foreach ($scenario in @('success','ci','bypass','missing','dispatch')) {
  $events = [System.Collections.Generic.List[string]]::new()
  $global:InfraForgeSetupEvents = $events
  $failed = $false
  $diagnostic = ''
  try { & "$PSScriptRoot/configure.ps1" -Enable } catch { $failed = $true; $diagnostic=$_.Exception.Message }
  if (($scenario -eq 'success') -eq $failed) { throw "Unexpected setup result: $scenario ($diagnostic)" }
  $writes = @($events | Where-Object { $_ -like 'variable set PRODUCTION_RELEASE_ENABLED*' })
  if ($writes[0] -notlike '*--body false') { throw 'Setup must disable admission first' }
  if ($scenario -eq 'success') {
    if ($writes[-1] -notlike '*--body true' -or $events[-1] -notlike 'workflow run*') { throw 'Setup did not enable last then dispatch' }
  } elseif ($writes[-1] -notlike '*--body false') { throw 'Failed setup left admission enabled' }
}
Write-Host 'Hosted setup fixture PASS: enable last, exact-SHA CI/protection/secret-name refusals, dispatch failure disables again; no hosted calls or real secrets.'
exit 0
