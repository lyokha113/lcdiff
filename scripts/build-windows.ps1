param(
  [string] $Bundles = "nsis",
  [string] $OutDir = "artifacts\windows",
  [switch] $SkipInstall,
  [switch] $SkipVerify,
  [switch] $SignIfSecretsPresent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "scripts\build-windows.ps1 must be run on Windows."
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [scriptblock] $Script
  )

  Write-Host "==> $Name"
  & $Script
}

function Require-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "required command not found on PATH: $Name"
  }
}

Require-Command "npm"
Require-Command "cargo"
Require-Command "bash"

if (-not $env:JAVA_HOME) {
  throw "JAVA_HOME must point to a Java 17 installation."
}

$jlink = Join-Path $env:JAVA_HOME "bin\jlink.exe"
if (-not (Test-Path -LiteralPath $jlink -PathType Leaf)) {
  throw "jlink.exe not found at JAVA_HOME: $jlink"
}

$bashJlink = (& bash -lc 'cygpath -u "$JAVA_HOME/bin/jlink.exe"').Trim()
if (-not $bashJlink) {
  throw "failed to convert JAVA_HOME jlink path for Git Bash."
}
$env:LCDIFF_JLINK = $bashJlink

if (-not $SkipInstall) {
  Invoke-Step "npm ci" { npm ci }
}

if (-not $SkipVerify) {
  Invoke-Step "frontend and docs verifiers" { npm run verify:all }
}

Invoke-Step "assemble bundled Java runtime resources" {
  bash scripts/assemble-sidecar-resources.sh
}
Invoke-Step "sidecar smoke" {
  bash scripts/test-sidecar-smoke.sh
}

Invoke-Step "build Windows bundles ($Bundles)" {
  npm run tauri -- build --bundles $Bundles
}

$bundleRoot = "target\release\bundle"
if (-not (Test-Path -LiteralPath $bundleRoot -PathType Container)) {
  throw "expected Windows bundle directory not found: $bundleRoot"
}

if ($SignIfSecretsPresent) {
  if ($env:WINDOWS_CERTIFICATE_BASE64 -and $env:WINDOWS_CERTIFICATE_PASSWORD) {
    $certPath = Join-Path ([System.IO.Path]::GetTempPath()) "lcdiff-windows-code-signing.pfx"
    [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE_BASE64) |
      Set-Content -AsByteStream -LiteralPath $certPath
    $timestampUrl = if ($env:WINDOWS_TIMESTAMP_URL) {
      $env:WINDOWS_TIMESTAMP_URL
    } else {
      "http://timestamp.digicert.com"
    }
    Invoke-Step "sign Windows bundles" {
      scripts/sign-windows-bundles.ps1 `
        -BundleDir $bundleRoot `
        -CertificatePath $certPath `
        -CertificatePassword "$env:WINDOWS_CERTIFICATE_PASSWORD" `
        -TimestampUrl $timestampUrl
    }
  } else {
    Write-Host "WINDOWS_CERTIFICATE_BASE64 or WINDOWS_CERTIFICATE_PASSWORD missing; skipping Windows signing."
  }
}

$package = Get-Content -LiteralPath "package.json" -Raw | ConvertFrom-Json
$version = [string] $package.version

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Get-ChildItem -LiteralPath $OutDir -Force | Remove-Item -Recurse -Force

$artifacts = Get-ChildItem -LiteralPath $bundleRoot -Recurse -File |
  Where-Object { $_.Extension -in ".exe", ".msi" }

if ($artifacts.Count -eq 0) {
  throw "no .exe or .msi bundles found under $bundleRoot"
}

foreach ($artifact in $artifacts) {
  $suffix = switch ($artifact.Extension.ToLowerInvariant()) {
    ".exe" { "setup.exe" }
    ".msi" { "setup.msi" }
    default { $artifact.Name }
  }
  $destination = Join-Path $OutDir "LCDiff-$version-windows-x64-$suffix"
  Copy-Item -LiteralPath $artifact.FullName -Destination $destination -Force
  Write-Host "copied $destination"
}

Write-Host "Windows release artifacts written to $OutDir"
