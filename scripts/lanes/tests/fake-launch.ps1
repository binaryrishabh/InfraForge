# Test double for codex-launch.ps1 (same parameters): runs fake-wrapper.sh as a detached worker in the lane's worktree.
param(
  [Parameter(Mandatory)][string]$Account, [Parameter(Mandatory)][string]$Model, [Parameter(Mandatory)][string]$Effort,
  [Parameter(Mandatory)][string]$Worktree, [Parameter(Mandatory)][string]$Brief, [Parameter(Mandatory)][string]$Log, [string]$Resume = ''
)
$ErrorActionPreference = 'Stop'
$ops = $env:LANE_OPS; $root = $env:LANE_ROOT
$active = "$ops/fake/active-$Account"
if (Test-Path $active) { $p = [int](Get-Content $active); if (Get-Process -Id $p -ErrorAction SilentlyContinue) { throw "Account $Account already has a running Codex session" } }
$id = $Brief -replace '(-resume\d+|-quotaresume)?\.md$', ''
$wrapper = (Resolve-Path "$PSScriptRoot/fake-wrapper.sh").Path.Replace([string][char]92, '/')
$cmd = "export OPS='$ops' WT='$root/$Worktree' SLICE='$id' ACCOUNT='$Account' RESUME='$Resume' BRIEF='$Brief' GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t; bash '$wrapper'"
& pwsh -NoProfile -File "$PSScriptRoot/../detached.ps1" -WorkDir "$root/$Worktree" -Log "$ops/reports/$Log" -CodexHome '' -Command $cmd
