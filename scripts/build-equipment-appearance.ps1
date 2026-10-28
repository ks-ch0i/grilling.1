$ErrorActionPreference = 'Stop'
$builder = Join-Path $PSScriptRoot 'build-equipment-appearance.py'
& python $builder
if ($LASTEXITCODE -ne 0) { throw "Equipment atlas builder failed with exit code $LASTEXITCODE" }
