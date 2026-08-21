# dsh-graykeep · zero-dependency launcher for Windows PowerShell
# One-click flow:  .\graykeep.ps1 pin   -> paste session id -> done
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Forward
)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $scriptDir 'bin\graykeep.js') @Forward
exit $LASTEXITCODE
