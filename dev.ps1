[CmdletBinding()]
param(
    [switch]$SetupOnly,
    [ValidatePattern('^infraforge_dev(?:_smoke_[a-f0-9]{16})?$')]
    [string]$DatabaseName = 'infraforge_dev'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot "apps/backend"
$frontendDirectory = Join-Path $repositoryRoot "apps/web"
$managedProcesses = [System.Collections.Generic.List[object]]::new()

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Get-RequiredCommand {
    param([Parameter(Mandatory)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command '$Name' was not found on PATH."
    }
    return $command.Source
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Write-Host "  $Description"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Description failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Assert-DevelopmentResources {
    param(
        [Parameter(Mandatory)][string]$DockerPath
    )

    $runningPorts = @{}
    foreach ($resource in @(
        @{ Kind = 'container'; Name = 'infraforge-dev-postgres' },
        @{ Kind = 'container'; Name = 'infraforge-dev-redis' },
        @{ Kind = 'volume'; Name = 'infraforge-dev-postgres-data' },
        @{ Kind = 'network'; Name = 'infraforge-dev-network' }
    )) {
        $raw = & $DockerPath $resource.Kind inspect $resource.Name 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        $item = @($raw | ConvertFrom-Json)[0]
        $labels = if ($resource.Kind -eq 'container') { $item.Config.Labels } else { $item.Labels }
        if (-not $labels -or $labels.'infraforge.project' -ne 'binaryrishabh/InfraForge' -or
            $labels.'infraforge.purpose' -ne 'development') {
            throw "Unknown Docker resource '$($resource.Name)' collides with local development. It was not changed."
        }
        if ($resource.Kind -eq 'container') {
            $service = if ($resource.Name -eq 'infraforge-dev-postgres') { 'postgres' } else { 'redis' }
            $port = if ($service -eq 'postgres') { '5432/tcp' } else { '6379/tcp' }
            $hostPort = if ($service -eq 'postgres') { '55432' } else { '56379' }
            $bindings = @($item.HostConfig.PortBindings.$port)
            if ($item.Config.Image -ne $(if ($service -eq 'postgres') { 'postgres:18-alpine' } else { 'redis:8-alpine' }) -or
                $labels.'com.docker.compose.project' -ne 'infraforge-dev' -or
                $labels.'com.docker.compose.service' -ne $service -or
                $bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1' -or $bindings[0].HostPort -ne $hostPort) {
                throw "Local container '$($resource.Name)' has unexpected configuration. It was not changed."
            }
            if ($service -eq 'postgres') {
                $data = @($item.Mounts | Where-Object Destination -eq '/var/lib/postgresql')
                if ($data.Count -ne 1 -or $data[0].Type -ne 'volume' -or $data[0].Name -ne 'infraforge-dev-postgres-data') {
                    throw 'Local PostgreSQL has an unexpected data mount. It was not changed.'
                }
            }
            if ($item.State.Running) { $runningPorts[$hostPort] = $true }
        }
    }
    foreach ($port in @(55432, 56379)) {
        if (-not $runningPorts.ContainsKey([string]$port) -and (Test-TcpPort -Port $port)) {
            throw "Port $port is occupied by an unknown service. It was not changed."
        }
    }
}

function Wait-ForContainerCommand {
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$ContainerName,
        [Parameter(Mandatory)][string]$DockerPath,
        [Parameter(Mandatory)][string[]]$Command,
        [int]$TimeoutSeconds = 60
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $null = & $DockerPath exec $ContainerName @Command 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  $ServiceName is ready."
            return
        }
        Start-Sleep -Milliseconds 500
    }

    throw "$ServiceName did not become ready within $TimeoutSeconds seconds (container '$ContainerName')."
}

function Test-TcpPort {
    param(
        [Parameter(Mandatory)][int]$Port,
        [int]$TimeoutMilliseconds = 250
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connection = $client.ConnectAsync("127.0.0.1", $Port)
        return $connection.Wait($TimeoutMilliseconds) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-HttpEndpoint {
    param([Parameter(Mandatory)][string]$Uri)

    try {
        $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -NoProxy -ProgressAction SilentlyContinue
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Start-ManagedService {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Write-Host "  Starting $Name..."
    try {
        $process = Start-Process `
            -FilePath $FilePath `
            -ArgumentList $Arguments `
            -WorkingDirectory $WorkingDirectory `
            -NoNewWindow `
            -PassThru
    }
    catch {
        throw "$Name failed to start: $($_.Exception.Message)"
    }

    $service = [PSCustomObject]@{
        Name = $Name
        Process = $process
    }
    $managedProcesses.Add($service)
    return $service
}

function Assert-ServiceStillRunning {
    param([Parameter(Mandatory)]$Service)

    if ($Service.Process.HasExited) {
        throw "$($Service.Name) exited unexpectedly with code $($Service.Process.ExitCode)."
    }
}

function Stop-ManagedServices {
    if ($managedProcesses.Count -eq 0) {
        return
    }

    Write-Host "`nStopping InfraForge application services..." -ForegroundColor Yellow
    foreach ($service in $managedProcesses) {
        if (-not $service.Process.HasExited) {
            # taskkill /T also stops child processes such as the Vite process
            # launched by `bun run dev`.
            $null = & taskkill.exe /PID $service.Process.Id /T /F 2>$null
        }
    }
}

try {
    Write-Step "Checking local prerequisites"
    $docker = Get-RequiredCommand "docker"
    $bun = Get-RequiredCommand "bun"

    $null = & $docker info 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is installed, but the Docker daemon is not available. Start Docker Desktop and try again."
    }

    if ($env:DOCKER_HOST -or $env:DOCKER_CONTEXT) { throw 'Unset Docker overrides and select a local context.' }
    $endpoint = & $docker context inspect --format '{{.Endpoints.docker.Host}}'
    if ($LASTEXITCODE -ne 0 -or $endpoint -notmatch '^(npipe:|unix:)') { throw 'Development requires a local Docker engine.' }
    $localEnv = Join-Path $repositoryRoot '.env.development.local'
    if (-not (Test-Path -LiteralPath $localEnv)) {
        if (-not $SetupOnly) { throw 'Run bun run dev:setup first.' }
        $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
        $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
        [IO.File]::WriteAllText($localEnv, "# InfraForge local development`nDEV_POSTGRES_PASSWORD=$password`nBETTER_AUTH_SECRET=$secret`n")
    }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $localEnv) {
        if ($line -match '^([A-Z_]+)=([a-f0-9]{64})$') { $values[$Matches[1]] = $Matches[2] }
        elseif ($line -and -not $line.StartsWith('#')) { throw 'Unexpected local development configuration; preserving the file.' }
    }
    if ($values.Count -ne 2 -or -not $values.DEV_POSTGRES_PASSWORD -or -not $values.BETTER_AUTH_SECRET) {
        throw 'Local development requires its generated database password and stable authentication secret.'
    }
    # Do not load backend .env files or inherit hosted database/provider settings.
    foreach ($entry in @(Get-ChildItem Env:)) {
        if ($entry.Name -match '^(PG|DATABASE|MIGRATION_DATABASE|WORKER_DATABASE|BETTER_AUTH|APP_ORIGINS|GOOGLE_|GITHUB_CLIENT|REDIS_|PORT$|NODE_ENV$|VITE_)') {
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    $env:DEV_POSTGRES_PASSWORD = $values.DEV_POSTGRES_PASSWORD
    $env:BETTER_AUTH_SECRET = $values.BETTER_AUTH_SECRET
    $env:DATABASE_URL = "postgresql://infraforge:$($values.DEV_POSTGRES_PASSWORD)@127.0.0.1:55432/$DatabaseName"
    $env:BETTER_AUTH_URL = 'http://localhost:3000'
    $env:APP_ORIGINS = 'http://localhost:5173'
    $env:REDIS_HOST = '127.0.0.1'
    $env:REDIS_PORT = '56379'
    $env:PORT = '3000'
    $env:LISTEN_HOST = '127.0.0.1'
    $env:WORKER_HEALTH_PORT = '3002'
    $env:NODE_ENV = 'development'
    $env:DOTENV_CONFIG_PATH = $localEnv
    $env:DOTENV_CONFIG_OVERRIDE = 'false'
    $env:VITE_BACKEND_API_URL = 'http://localhost:3000/api'
    $env:VITE_WS_URL = 'ws://localhost:3001'

    Write-Step "Starting local data services"
    Assert-DevelopmentResources -DockerPath $docker
    Invoke-CheckedCommand -Description 'Preparing owned local PostgreSQL 18 and Redis 8' -FilePath $docker `
        -Arguments @('compose', '--env-file', $localEnv, '-f', 'ops/compose.dev.yml', 'up', '-d') -WorkingDirectory $repositoryRoot

    Write-Step "Waiting for PostgreSQL and Redis"
    Wait-ForContainerCommand `
        -ServiceName "PostgreSQL" `
        -ContainerName "infraforge-dev-postgres" `
        -DockerPath $docker `
        -Command @("pg_isready", "-U", "infraforge", "-d", "infraforge_dev")
    Wait-ForContainerCommand `
        -ServiceName "Redis" `
        -ContainerName "infraforge-dev-redis" `
        -DockerPath $docker `
        -Command @("redis-cli", "ping")

    foreach ($port in @(55432, 56379)) {
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while (-not (Test-TcpPort -Port $port)) {
            if ([DateTime]::UtcNow -ge $deadline) { throw "Local data port $port is unreachable from the host." }
            Start-Sleep -Milliseconds 500
        }
    }

    if ($SetupOnly) { Write-Host 'Local services are ready. Run bun run dev.'; return }

    Write-Step "Checking application ports"
    foreach ($port in @(3000, 3001, 3002, 5173)) {
        if (Test-TcpPort -Port $port) {
            throw "Port $port is already in use. Stop the existing process before launching InfraForge."
        }
    }
    Write-Host "  Ports 3000, 3001, 3002, and 5173 are available."

    Write-Step "Preparing the local database client"
    Invoke-CheckedCommand `
        -Description "Applying committed Prisma migrations" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "db:migrate") `
        -WorkingDirectory $backendDirectory
    Invoke-CheckedCommand `
        -Description "Generating the Prisma client" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "db:generate") `
        -WorkingDirectory $backendDirectory

    Write-Step "Starting InfraForge application services"
    $api = Start-ManagedService `
        -Name "Backend API" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "index.ts") `
        -WorkingDirectory $backendDirectory
    $worker = Start-ManagedService `
        -Name "Worker/simulator" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "worker.ts") `
        -WorkingDirectory $backendDirectory
    $webSocket = Start-ManagedService `
        -Name "WebSocket server" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "ws-server.ts") `
        -WorkingDirectory $backendDirectory
    $frontend = Start-ManagedService `
        -Name "apps/web" `
        -FilePath $bun `
        -Arguments @("--no-env-file", "run", "dev", "--host", "127.0.0.1", "--strictPort") `
        -WorkingDirectory $frontendDirectory

    Write-Step "Waiting for application services"
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(60)
    $workerStableAt = [DateTime]::UtcNow.AddSeconds(8)
    $apiReady = $false
    $webSocketReady = $false
    $frontendReady = $false

    while ([DateTime]::UtcNow -lt $startupDeadline) {
        foreach ($service in $managedProcesses) {
            Assert-ServiceStillRunning -Service $service
        }

        if (-not $apiReady) {
            $apiReady = Test-HttpEndpoint -Uri "http://127.0.0.1:3000/health"
        }
        if (-not $webSocketReady) {
            $webSocketReady = Test-HttpEndpoint -Uri "http://127.0.0.1:3001/health/ready"
        }
        if (-not $frontendReady) {
            $frontendReady = Test-HttpEndpoint -Uri "http://127.0.0.1:5173/"
        }

        $workerReady = [DateTime]::UtcNow -ge $workerStableAt -and
            (Test-HttpEndpoint -Uri "http://127.0.0.1:3002/health/ready")
        if ($apiReady -and $webSocketReady -and $frontendReady -and $workerReady) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $apiReady) { throw "Backend API did not become ready on http://127.0.0.1:3000/health." }
    if (-not $webSocketReady) { throw "WebSocket server did not become ready on port 3001." }
    if (-not $workerReady) { throw "Worker did not become ready on port 3002." }
    if (-not $frontendReady) { throw "Frontend did not become ready on http://localhost:5173/." }
    Assert-ServiceStillRunning -Service $worker

    Write-Host "`nInfraForge is running:" -ForegroundColor Green
    Write-Host "  Frontend:  http://localhost:5173"
    Write-Host "  API:       http://localhost:3000"
    Write-Host "  WebSocket: ws://localhost:3001"
    Write-Host "`nLogs from all services will remain visible here. Press Ctrl+C to stop the application services."
    Write-Host "The PostgreSQL and Redis containers will remain running."

    while ($true) {
        foreach ($service in $managedProcesses) {
            Assert-ServiceStillRunning -Service $service
        }
        Start-Sleep -Seconds 1
    }
}
catch {
    Write-Host "`nInfraForge launcher failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Stop-ManagedServices
}
