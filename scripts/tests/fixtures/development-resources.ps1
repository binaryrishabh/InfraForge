param([switch]$Live)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repositoryRoot 'dev.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Launcher parse errors: $errors" }
# Load function definitions only: never execute the launcher's top-level setup or startup.
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
if ($Live) {
    Assert-DevelopmentResources -DockerPath (Get-Command docker).Source
    Write-Output 'PASS: live development resource assertion; no application services started.'
    return
}

$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json -AsHashtable
function Test-TcpPort { param($Port) return $false }
function Invoke-FixtureDocker {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'compose') {
        if ($case.ContainsKey('ComposeFailure')) { $global:LASTEXITCODE = 1; return }
        $configuration = if ($case.ContainsKey('Compose')) { $case.Compose } else { $inputData.Compose }
        return ($configuration | ConvertTo-Json -Depth 30 -Compress)
    }
    $name = $args[2]
    if (-not $case.Resources.ContainsKey($name)) { $global:LASTEXITCODE = 1; return }
    return (ConvertTo-Json -InputObject @($case.Resources[$name]) -Depth 30 -Compress)
}
$results = foreach ($case in $inputData.Cases) {
    try {
        Assert-DevelopmentResources -DockerPath Invoke-FixtureDocker
        @{ Name = $case.Name; Error = $null }
    }
    catch { @{ Name = $case.Name; Error = $_.Exception.Message } }
}
ConvertTo-Json -InputObject @($results) -Compress
