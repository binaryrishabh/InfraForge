[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = $PSScriptRoot
$backendDirectory = Join-Path $repositoryRoot "Backend"
$frontendDirectory = Join-Path $repositoryRoot "Frontend"
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

function Ensure-ContainerRunning {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$DockerPath
    )

    $running = & $DockerPath inspect --format "{{.State.Running}}" $Name 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker container '$Name' does not exist. This launcher only starts the known local containers; it does not create or reconfigure them."
    }

    if (($running | Out-String).Trim() -ne "true") {
        Write-Host "  Starting $Name..."
        $null = & $DockerPath start $Name
        if ($LASTEXITCODE -ne 0) {
            throw "Docker container '$Name' failed to start."
        }
    }
    else {
        Write-Host "  $Name is already running."
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
        $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
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

    foreach ($envFile in @(
        (Join-Path $backendDirectory ".env"),
        (Join-Path $frontendDirectory ".env")
    )) {
        if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
            throw "Required local environment file is missing: $envFile"
        }
    }

    # Do not let values inherited from the caller's shell override the
    # repository-local development configuration loaded by dotenv and Vite.
    foreach ($variableName in @(
        "DATABASE_URL",
        "PORT",
        "NODE_ENV",
        "REDIS_HOST",
        "REDIS_PORT",
        "VITE_BACKEND_API_URL",
        "VITE_WS_URL"
    )) {
        Remove-Item -LiteralPath "Env:$variableName" -ErrorAction SilentlyContinue
    }
    Write-Host "  Bun, Docker, and local environment files are available."

    Write-Step "Starting local data services"
    Ensure-ContainerRunning -Name "InfraForgePostgres" -DockerPath $docker
    Ensure-ContainerRunning -Name "InfraForgeRedis" -DockerPath $docker

    Write-Step "Waiting for PostgreSQL and Redis"
    Wait-ForContainerCommand `
        -ServiceName "PostgreSQL" `
        -ContainerName "InfraForgePostgres" `
        -DockerPath $docker `
        -Command @("pg_isready")
    Wait-ForContainerCommand `
        -ServiceName "Redis" `
        -ContainerName "InfraForgeRedis" `
        -DockerPath $docker `
        -Command @("redis-cli", "ping")

    Write-Step "Checking application ports"
    foreach ($port in @(3000, 3001, 5173)) {
        if (Test-TcpPort -Port $port) {
            throw "Port $port is already in use. Stop the existing process before launching InfraForge."
        }
    }
    Write-Host "  Ports 3000, 3001, and 5173 are available."

    Write-Step "Preparing the local database client"
    Invoke-CheckedCommand `
        -Description "Applying committed Prisma migrations" `
        -FilePath $bun `
        -Arguments @("run", "db:migrate") `
        -WorkingDirectory $backendDirectory
    Invoke-CheckedCommand `
        -Description "Generating the Prisma client" `
        -FilePath $bun `
        -Arguments @("run", "db:generate") `
        -WorkingDirectory $backendDirectory

    Write-Step "Starting InfraForge application services"
    $api = Start-ManagedService `
        -Name "Backend API" `
        -FilePath $bun `
        -Arguments @("run", "index.ts") `
        -WorkingDirectory $backendDirectory
    $worker = Start-ManagedService `
        -Name "Worker/simulator" `
        -FilePath $bun `
        -Arguments @("run", "worker.ts") `
        -WorkingDirectory $backendDirectory
    $webSocket = Start-ManagedService `
        -Name "WebSocket server" `
        -FilePath $bun `
        -Arguments @("run", "ws-server.ts") `
        -WorkingDirectory $backendDirectory
    $frontend = Start-ManagedService `
        -Name "Frontend" `
        -FilePath $bun `
        -Arguments @("run", "dev") `
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
            $webSocketReady = Test-TcpPort -Port 3001
        }
        if (-not $frontendReady) {
            $frontendReady = Test-HttpEndpoint -Uri "http://localhost:5173/"
        }

        $workerReady = [DateTime]::UtcNow -ge $workerStableAt
        if ($apiReady -and $webSocketReady -and $frontendReady -and $workerReady) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $apiReady) { throw "Backend API did not become ready on http://127.0.0.1:3000/health." }
    if (-not $webSocketReady) { throw "WebSocket server did not become ready on port 3001." }
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
