#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$Base = [System.IO.Path]::GetFileNameWithoutExtension($MyInvocation.MyCommand.Name)
$Script = Join-Path $PSScriptRoot "$Base.mjs"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node is required to run $Base"
    exit 1
}

& node $Script @args
exit $LASTEXITCODE
