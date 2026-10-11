# Synchronize the tutor text and invalidate the running preset's composition stamp.
param(
    [string]$PresetDirectory = (Join-Path $env:USERPROFILE '.dsh/.agent-presets/axisverse')
)

$ErrorActionPreference = 'Stop'
$sourcePrompt = Join-Path $PSScriptRoot '../apps/web/axisverse-presets/axisverse/tutor-prompt.txt'
$targetPrompt = Join-Path $PresetDirectory 'tutor-prompt.txt'
$composition = Join-Path $PresetDirectory 'agent.cordis.yml'
if (-not (Test-Path -LiteralPath $composition -PathType Leaf)) {
    throw "AxisVerse preset configuration was not found: $composition"
}

Copy-Item -LiteralPath $sourcePrompt -Destination $targetPrompt -Force
if ((Get-FileHash -LiteralPath $sourcePrompt).Hash -ne (Get-FileHash -LiteralPath $targetPrompt).Hash) {
    throw 'The installed AxisVerse prompt differs from the source.'
}

# The preset loader watches the composition file, not files read by its expressions.
$compositionFile = Get-Item -LiteralPath $composition
$nextStamp = [DateTime]::UtcNow
if ($nextStamp -le $compositionFile.LastWriteTimeUtc) {
    $nextStamp = $compositionFile.LastWriteTimeUtc.AddSeconds(1)
}
$compositionFile.LastWriteTimeUtc = $nextStamp
Write-Output 'AxisVerse prompt synchronized. New conversations will reload the preset.'
