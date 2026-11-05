# Starts a command as an independent process that survives the lead's session restarts.
# Usage: pwsh -File detached.ps1 -WorkDir <dir> -Log <file> -CodexHome <dir or ''> -Command <bash command line>
param(
    [Parameter(Mandatory)][string]$WorkDir,
    [Parameter(Mandatory)][string]$Log,
    [string]$CodexHome = '',
    [Parameter(Mandatory)][string]$Command
)
$bash = 'C:\Program Files\Git\bin\bash.exe'
$script = Join-Path ([IO.Path]::GetTempPath()) ("detached-" + [guid]::NewGuid().ToString('N') + '.sh')
$lines = @('#!/usr/bin/env bash', "cd '$WorkDir' || exit 1")
if ($CodexHome) { $lines += "export CODEX_HOME='$CodexHome'" }
$lines += "{ $Command ; } < /dev/null >> '$Log' 2>&1"
# LF line endings: bash rejects CRLF scripts.
[IO.File]::WriteAllText($script, ($lines -join "`n") + "`n")
$proc = Start-Process -FilePath $bash -ArgumentList @('-l', "`"$script`"") -WindowStyle Hidden -PassThru
"started pid $($proc.Id) script $script"
