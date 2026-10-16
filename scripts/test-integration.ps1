param(
    [switch]$SafetyGuardsOnly,
    [switch]$AuthOnly,
    [switch]$LearningOnly,
    [switch]$Model2Only,
    [ValidatePattern('^[a-f0-9]{32}$')][string]$CleanupRun,
    [ValidatePattern('^[a-z0-9][a-z0-9._/-]*:[a-z0-9._-]+$')][string]$RuntimeImage
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dockerExe = (Get-Command docker -ErrorAction Stop).Source
if ($env:DOCKER_HOST) { throw 'Unset DOCKER_HOST and select a local Docker context first.' }

function Invoke-Docker([string[]]$DockerArgs) {
    $start = [Diagnostics.ProcessStartInfo]::new($dockerExe)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = 'Hidden'
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    if ($script:dockerContext) {
        $start.ArgumentList.Add('--context')
        $start.ArgumentList.Add($script:dockerContext)
    }
    foreach ($argument in $DockerArgs) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    try {
        if (!$process.WaitForExit(30000)) {
            $process.Kill($true)
            throw "Docker command timed out: $($DockerArgs[0])"
        }
        if ($process.ExitCode -ne 0) {
            throw "Docker $($DockerArgs[0]) failed: $($stderr.GetAwaiter().GetResult().Trim())"
        }
        return $stdout.GetAwaiter().GetResult().Trim()
    } finally { $process.Dispose() }
}

$script:dockerContext = Invoke-Docker @('context', 'show')
$endpoint = Invoke-Docker @('context', 'inspect', $script:dockerContext, '--format', '{{.Endpoints.docker.Host}}')
if ($endpoint -notmatch '^(npipe:////\./pipe/|unix:///)' ) {
    throw 'Integration fixtures require a local pipe or Unix-socket Docker context.'
}

$run = if ($CleanupRun) { $CleanupRun } else { [guid]::NewGuid().ToString('N') }
$prefix = "infraforge-it-$run"
$names = @{ runtime = "$prefix-runtime"; postgres = "$prefix-pg"; redis = "$prefix-redis"; volume = "$prefix-data"; network = "$prefix-net" }
$labels = @{ 'infraforge.project' = 'binaryrishabh/InfraForge'; 'infraforge.purpose' = 'integration';
    'infraforge.run' = $run; 'infraforge.temporary' = 'true' }
$labelArgs = @()
foreach ($label in $labels.GetEnumerator()) { $labelArgs += @('--label', "$($label.Key)=$($label.Value)") }
$evidenceDir = Join-Path ([IO.Path]::GetTempPath()) $prefix
[IO.Directory]::CreateDirectory($evidenceDir) | Out-Null
$record = [ordered]@{ run = $run; context = $script:dockerContext; names = $names;
    startedAt = [DateTime]::UtcNow.ToString('o'); result = 'starting'; cleanupErrors = @() }
$recordFile = if ($CleanupRun) { "cleanup-$([DateTime]::UtcNow.Ticks).json" } else { 'resources.json' }
$recordPath = Join-Path $evidenceDir $recordFile
function Save-Record { [IO.File]::WriteAllText($recordPath, ($record | ConvertTo-Json -Depth 6)) }

function Assert-Labels($actual) {
    foreach ($label in $labels.GetEnumerator()) {
        if (!$actual -or $actual.($label.Key) -ne $label.Value) {
            throw "Ownership label mismatch; preserving resources for run $run"
        }
    }
}

function Remove-Fixtures {
    $errors = [Collections.Generic.List[string]]::new()
    foreach ($name in @($names.runtime, $names.redis, $names.postgres)) {
        try {
            $found = Invoke-Docker @('ps', '-a', '--filter', "name=^/$name$", '--format', '{{.Names}}')
            if (!$found) { continue }
            $container = (Invoke-Docker @('inspect', $name) | ConvertFrom-Json)[0]
            Assert-Labels $container.Config.Labels
            if ($container.State.Running) { Invoke-Docker @('stop', '--time', '10', $container.Id) | Out-Null }
            Invoke-Docker @('rm', $container.Id) | Out-Null
        } catch { $errors.Add($_.Exception.Message) }
    }
    try {
        $found = Invoke-Docker @('volume', 'ls', '--filter', "name=^$($names.volume)$", '--format', '{{.Name}}')
        if ($found) {
            $volume = (Invoke-Docker @('volume', 'inspect', $names.volume) | ConvertFrom-Json)[0]
            Assert-Labels $volume.Labels
            $references = Invoke-Docker @('ps', '-aq', '--filter', "volume=$($names.volume)")
            if ($references) { throw 'Disposable volume is still referenced; preserving it.' }
            Invoke-Docker @('volume', 'rm', $names.volume) | Out-Null
        }
    } catch { $errors.Add($_.Exception.Message) }
    try {
        $found = Invoke-Docker @('network', 'ls', '--filter', "name=^$($names.network)$", '--format', '{{.Name}}')
        if ($found) {
            $network = (Invoke-Docker @('network', 'inspect', $names.network) | ConvertFrom-Json)[0]
            Assert-Labels $network.Labels
            if ($network.Containers.PSObject.Properties.Count -gt 0) { throw 'Temporary network is still referenced; preserving it.' }
            Invoke-Docker @('network', 'rm', $names.network) | Out-Null
        }
    } catch { $errors.Add($_.Exception.Message) }
    try {
        foreach ($kind in @('ps', 'volume', 'network')) {
            $arguments = if ($kind -eq 'ps') { @('ps', '-aq') } else { @($kind, 'ls', '-q') }
            $remaining = Invoke-Docker ($arguments + @('--filter', "label=infraforge.run=$run"))
            if ($remaining) { throw "Cleanup incomplete: $kind resources remain for $run" }
        }
    } catch { $errors.Add($_.Exception.Message) }
    return $errors.ToArray()
}

$testProcess = $null
$testOutput = $null
$testErrors = $null
$exitCode = 1
Save-Record
Write-Host "Run $run; evidence: $evidenceDir"
try {
    if ($CleanupRun) { $record.result = 'cleanup-only'; $exitCode = 0 }
    else {
        if ($RuntimeImage) {
            $image = (Invoke-Docker @('image', 'inspect', $RuntimeImage) | ConvertFrom-Json)[0]
            $head = (& git -C $repoRoot rev-parse HEAD).Trim()
            if ($image.Config.Labels.'org.opencontainers.image.source' -ne 'https://github.com/binaryrishabh/InfraForge' -or
                $image.Config.Labels.'org.opencontainers.image.revision' -ne $head) { throw 'Runtime image must match this exact repository HEAD.' }
            $record.runtimeImage = $RuntimeImage
            $record.runtimeImageId = $image.Id
        }
        Invoke-Docker (@('network', 'create') + $labelArgs + @($names.network)) | Out-Null
        Invoke-Docker (@('volume', 'create') + $labelArgs + @($names.volume)) | Out-Null
        $common = @('run', '-d', '--pull=never') + $labelArgs + @('--network', $names.network)
        Invoke-Docker ($common + @('--name', $names.postgres, '--publish', '127.0.0.1::5432',
            '--mount', "type=volume,source=$($names.volume),target=/var/lib/postgresql",
            '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', "POSTGRES_DB=infraforge_it_$run",
            '--health-cmd', 'pg_isready -U postgres', '--health-interval', '1s', '--health-retries', '30', 'postgres:18-alpine')) | Out-Null
        if ($RuntimeImage) {
            # Share only this owned fixture namespace: all test URLs stay loopback.
            Invoke-Docker (@('run', '-d', '--pull=never') + $labelArgs + @('--network', "container:$($names.postgres)",
                '--name', $names.redis, '--tmpfs', '/data', '--health-cmd', 'redis-cli -p 56379 ping',
                '--health-interval', '1s', '--health-retries', '30', 'redis:8-alpine', 'redis-server', '--port', '56379')) | Out-Null
        } else {
            Invoke-Docker ($common + @('--name', $names.redis, '--publish', '127.0.0.1::6379', '--tmpfs', '/data',
                '--health-cmd', 'redis-cli ping', '--health-interval', '1s', '--health-retries', '30', 'redis:8-alpine')) | Out-Null
        }
        foreach ($name in @($names.postgres, $names.redis)) {
            $deadline = [DateTime]::UtcNow.AddSeconds(40)
            do {
                $health = Invoke-Docker @('inspect', $name, '--format', '{{.State.Health.Status}}')
                if ($health -eq 'healthy') { break }
                if ([DateTime]::UtcNow -gt $deadline) { throw "Fixture readiness timed out: $name" }
                Start-Sleep -Milliseconds 200
            } while ($true)
        }
        $pgPort = Invoke-Docker @('inspect', $names.postgres, '--format', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')
        $redisPort = if ($RuntimeImage) { '56379' } else { Invoke-Docker @('inspect', $names.redis, '--format', '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}') }
        $start = [Diagnostics.ProcessStartInfo]::new($(if ($RuntimeImage) { $dockerExe } else { (Get-Command bun -ErrorAction Stop).Source }))
        $start.WorkingDirectory = if ($SafetyGuardsOnly -or $AuthOnly -or $LearningOnly -or $Model2Only) { Join-Path $repoRoot 'apps/backend' } else { $repoRoot }
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.WindowStyle = 'Hidden'
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.Environment.Clear()
        foreach ($name in @('PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR')) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($null -ne $value) { $start.Environment[$name] = $value }
        }
        $start.Environment['INTEGRATION_RUN'] = '1'
        if ($AuthOnly) { $start.Environment['INTEGRATION_AUTH_ONLY'] = '1' }
        if ($LearningOnly) { $start.Environment['INTEGRATION_LEARNING_ONLY'] = '1' }
        if ($Model2Only) { $start.Environment['INTEGRATION_MODEL2_ONLY'] = '1' }
        $start.Environment['INTEGRATION_DISPOSABLE'] = 'local-only'
        $start.Environment['INTEGRATION_DATABASE_URL'] = "postgresql://postgres@127.0.0.1:$pgPort/infraforge_it_$run"
        $start.Environment['INTEGRATION_REDIS_PORT'] = $redisPort
        $start.Environment['INTEGRATION_API_PORT'] = '3100'
        $start.Environment['DATABASE_URL'] = $start.Environment['INTEGRATION_DATABASE_URL']
        $start.Environment['DOTENV_CONFIG_PATH'] = Join-Path $evidenceDir 'absent.env'
        $start.Environment['DOTENV_CONFIG_OVERRIDE'] = 'false'
        $start.Environment['DO_NOT_TRACK'] = '1'
        $arguments = if ($SafetyGuardsOnly) { @('test', 'tests/integration/localHarness.test.ts') } elseif ($AuthOnly -or $LearningOnly -or $Model2Only) { @('test', 'tests/integration/deployment.integration.test.ts') } else { @('run', 'test:integration') }
        if ($RuntimeImage) {
            Invoke-Docker (@('run', '-d', '--pull=never') + $labelArgs + @('--network', "container:$($names.postgres)",
                '--name', $names.runtime, $image.Id, 'sleep', 'infinity')) | Out-Null
            # Authored tests only; never mount the checkout or local environment files.
            Invoke-Docker @('cp', (Join-Path $repoRoot 'apps/backend/tests'), "$($names.runtime):/app/apps/backend/tests") | Out-Null
            $environment = @('INTEGRATION_RUN=1', 'INTEGRATION_DISPOSABLE=local-only',
                "INTEGRATION_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/infraforge_it_$run",
                "DATABASE_URL=postgresql://postgres@127.0.0.1:5432/infraforge_it_$run", 'INTEGRATION_REDIS_PORT=56379',
                'INTEGRATION_API_PORT=3100', 'DOTENV_CONFIG_PATH=/tmp/infraforge-absent.env', 'DOTENV_CONFIG_OVERRIDE=false', 'DO_NOT_TRACK=1')
            $arguments = @('--host', $endpoint, 'exec', '--workdir', '/app/apps/backend')
            if ($AuthOnly) { $environment += 'INTEGRATION_AUTH_ONLY=1' }
            if ($LearningOnly) { $environment += 'INTEGRATION_LEARNING_ONLY=1' }
            if ($Model2Only) { $environment += 'INTEGRATION_MODEL2_ONLY=1' }
            foreach ($setting in $environment) { $arguments += @('--env', $setting) }
            $arguments += @($names.runtime, 'bun', '--no-env-file', '--no-install', 'test', $(if ($SafetyGuardsOnly) { 'tests/integration/localHarness.test.ts' } elseif ($AuthOnly -or $LearningOnly -or $Model2Only) { 'tests/integration/deployment.integration.test.ts' } else { 'tests/integration' }))
        } else { $arguments = @('--no-env-file', '--no-install') + $arguments }
        foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) }
        $record.result = 'testing'
        Save-Record
        $testProcess = [Diagnostics.Process]::Start($start)
        $record.testPid = $testProcess.Id
        Save-Record
        $testOutput = $testProcess.StandardOutput.ReadToEndAsync()
        $testErrors = $testProcess.StandardError.ReadToEndAsync()
        while (!$testProcess.HasExited) { Start-Sleep -Milliseconds 100 }
        $exitCode = $testProcess.ExitCode
        $record.result = if ($exitCode -eq 0) { 'passed' } else { 'failed' }
    }
} catch {
    $record.result = 'interrupted-or-failed'
    $record.error = $_.Exception.Message
    Write-Warning $_.Exception.Message
} finally {
    if ($record.result -in @('starting', 'testing')) { $record.result = 'interrupted-or-failed' }
    if ($testProcess) {
        try {
            if (!$testProcess.HasExited) { $testProcess.Kill($true); $testProcess.WaitForExit(5000) | Out-Null }
            foreach ($stream in @(@{ task = $testOutput; name = 'stdout.log' }, @{ task = $testErrors; name = 'stderr.log' })) {
                if ($stream.task) {
                    if (!$stream.task.Wait(5000)) { throw 'Test output capture timed out.' }
                    [IO.File]::WriteAllText((Join-Path $evidenceDir $stream.name), $stream.task.GetAwaiter().GetResult())
                }
            }
            if ($RuntimeImage) {
                $output = [IO.File]::ReadAllText((Join-Path $evidenceDir 'stdout.log')) + [IO.File]::ReadAllText((Join-Path $evidenceDir 'stderr.log'))
                foreach ($match in [regex]::Matches($output, 'Integration evidence: (/tmp/infraforge-integration-[a-f0-9-]{36}\.json)')) {
                    $file = $match.Groups[1].Value
                    Invoke-Docker @('cp', "$($names.runtime):$file", (Join-Path $evidenceDir ([IO.Path]::GetFileName($file)))) | Out-Null
                }
            }
        } catch { $record.processCleanupError = $_.Exception.Message; $exitCode = 1 }
        finally { $testProcess.Dispose() }
    }
    $record.cleanupErrors = @(Remove-Fixtures)
    if ($record.cleanupErrors.Count) {
        $exitCode = 1
        Write-Warning ($record.cleanupErrors -join '; ')
        Write-Warning "Retry on the same Docker context: pwsh ./scripts/test-integration.ps1 -CleanupRun $run"
    } else { Write-Host "Cleanup confirmed for $run" }
    $record.exitCode = $exitCode
    $record.finishedAt = [DateTime]::UtcNow.ToString('o')
    Save-Record
}
exit $exitCode
