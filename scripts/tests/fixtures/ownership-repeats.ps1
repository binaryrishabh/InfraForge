param([Parameter(Mandatory)][string]$Baseline, [int]$Repeats = 5)
$ErrorActionPreference = 'Stop'
if ($env:DOCKER_HOST) { throw 'Ownership fixtures require a local Docker context without DOCKER_HOST' }
$fixtureContext = (& docker context show).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot select Docker context' }
$endpoint = (& docker context inspect $fixtureContext --format '{{.Endpoints.docker.Host}}').Trim()
if ($LASTEXITCODE -ne 0 -or $endpoint -notmatch '^(npipe:////\./pipe/|unix:///)') { throw 'Ownership fixtures require a local Docker endpoint' }
$env:DOCKER_CONTEXT = $fixtureContext
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
if ((git -C $Baseline rev-parse HEAD).Trim() -ne '1d4b3211f6169d1dda2b9fcab33c7b02b6705c9b') { throw 'Unexpected baseline commit' }
$run = [guid]::NewGuid().ToString('N')
$prefix = "infraforge-it-$run"
$evidence = Join-Path ([IO.Path]::GetTempPath()) "infraforge-e3-ownership-$run"
[IO.Directory]::CreateDirectory($evidence) | Out-Null
$labels = @('--label', 'infraforge.project=binaryrishabh/InfraForge', '--label', 'infraforge.purpose=integration', '--label', "infraforge.run=$run", '--label', 'infraforge.temporary=true')
$results = @()
function Docker([string[]]$arguments) { $output = & docker @arguments; if ($LASTEXITCODE -ne 0) { throw "Docker $($arguments[0]) failed" }; return $output }
try {
  Docker (@('network', 'create') + $labels + @("$prefix-net")) | Out-Null
  Docker (@('volume', 'create') + $labels + @("$prefix-data")) | Out-Null
  Docker (@('run', '-d', '--pull=never') + $labels + @('--name', "$prefix-pg", '--network', "$prefix-net", '--publish', '127.0.0.1::5432', '--mount', "type=volume,source=$prefix-data,target=/var/lib/postgresql", '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', "POSTGRES_DB=infraforge_it_$run", 'postgres:18-alpine')) | Out-Null
  Docker (@('run', '-d', '--pull=never') + $labels + @('--name', "$prefix-redis", '--network', "$prefix-net", '--publish', '127.0.0.1::6379', '--tmpfs', '/data', 'redis:8-alpine')) | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  do { & docker exec "$prefix-pg" pg_isready -h 127.0.0.1 -U postgres *> $null; if ($LASTEXITCODE -eq 0) { break }; if ([DateTime]::UtcNow -gt $deadline) { throw 'Postgres readiness timed out' }; Start-Sleep -Milliseconds 200 } while ($true)
  $pg = (Docker @('inspect', "$prefix-pg", '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')).Trim()
  $redis = (Docker @('inspect', "$prefix-redis", '--format', '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}')).Trim()
  foreach ($checkout in @(@{ name = 'baseline'; path = $Baseline }, @{ name = 'HEAD'; path = $root })) {
    for ($i = 1; $i -le $Repeats; $i++) {
      $tag = "$($checkout.name)-$i"
      $start = [Diagnostics.ProcessStartInfo]::new((Get-Command bun).Source)
      $start.WorkingDirectory = Join-Path $checkout.path 'apps/backend'
      $start.UseShellExecute = $false; $start.CreateNoWindow = $true; $start.WindowStyle = 'Hidden'
      $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
      $start.Environment.Clear()
      foreach ($key in @('PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP')) { $value = [Environment]::GetEnvironmentVariable($key); if ($value) { $start.Environment[$key] = $value } }
      $start.Environment['INTEGRATION_RUN'] = '1'; $start.Environment['INTEGRATION_DISPOSABLE'] = 'local-only'
      $start.Environment['INTEGRATION_DATABASE_URL'] = "postgresql://postgres@127.0.0.1:$pg/infraforge_it_$run"
      $start.Environment['INTEGRATION_REDIS_PORT'] = $redis; $start.Environment['INTEGRATION_API_PORT'] = '3100'
      foreach ($arg in @('--no-env-file', '--no-install', 'test', 'tests/integration/workerOwnership.integration.test.ts')) { $start.ArgumentList.Add($arg) }
      $timer = [Diagnostics.Stopwatch]::StartNew(); $process = [Diagnostics.Process]::Start($start)
      $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync(); $watchdog = $false
      $activity = [Collections.Generic.List[object]]::new()
      while (!$process.WaitForExit(1000)) {
        $snapshot = Docker @('exec', "$prefix-pg", 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', "SELECT pid,datname,state,wait_event_type,wait_event,left(query,120) FROM pg_stat_activity WHERE backend_type='client backend' AND datname <> 'postgres'; SELECT pid,classid,objid,granted FROM pg_locks WHERE locktype='advisory';")
        $activity.Add(@{ elapsedMs = $timer.ElapsedMilliseconds; state = @($snapshot) })
        if ($timer.Elapsed.TotalSeconds -gt 75) { $watchdog = $true; $process.Kill($true); $process.WaitForExit(); break }
      }
      $timer.Stop()
      [IO.File]::WriteAllText((Join-Path $evidence "$tag.log"), $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult())
      [IO.File]::WriteAllText((Join-Path $evidence "$tag-activity.json"), ($activity | ConvertTo-Json -Depth 6))
      $entry = @{ checkout = $checkout.name; commit = (git -C $checkout.path rev-parse HEAD).Trim(); repeat = $i; seconds = [Math]::Round($timer.Elapsed.TotalSeconds,3); exitCode = $process.ExitCode; watchdog = $watchdog }
      $results += $entry; $process.Dispose()
      [IO.File]::WriteAllText((Join-Path $evidence 'results.json'), ($results | ConvertTo-Json -Depth 6))
      Write-Host ($entry | ConvertTo-Json -Compress)
    }
  }
} finally {
  & pwsh -NoProfile -File (Join-Path $root 'scripts/test-integration.ps1') -CleanupRun $run
  if ($LASTEXITCODE -ne 0) { throw "Cleanup failed for $run" }
  Write-Host "Ownership evidence: $evidence"
}
