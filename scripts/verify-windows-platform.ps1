param(
  [switch] $SkipInstall,
  [switch] $SkipBundle,
  [switch] $SignIfSecretsPresent,
  [string] $Bundles = "nsis,msi",
  [string] $BundleDir = "target\debug\bundle"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "scripts\verify-windows-platform.ps1 must be run on Windows."
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

$env:LCDIFF_JLINK = $jlink

if (-not $SkipInstall) {
  Invoke-Step "npm ci" { npm ci }
  Invoke-Step "install Playwright Chromium" { npx playwright install chromium }
}

Invoke-Step "cargo fmt" { cargo fmt --all -- --check }
Invoke-Step "cargo test" { cargo test --workspace }
Invoke-Step "cargo clippy" { cargo clippy --workspace --all-targets -- -D warnings }
Invoke-Step "frontend and release verifiers" { npm run verify:all }
Invoke-Step "assemble bundled Java runtime resources" { bash scripts/assemble-sidecar-resources.sh }
Invoke-Step "sidecar smoke" { bash scripts/test-sidecar-smoke.sh }

if (-not $SkipBundle) {
  Invoke-Step "build Windows debug bundles" { npm run tauri -- build --debug --bundles $Bundles }
  if (-not (Test-Path -LiteralPath $BundleDir -PathType Container)) {
    throw "expected Windows bundle directory not found: $BundleDir"
  }
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
        -BundleDir $BundleDir `
        -CertificatePath $certPath `
        -CertificatePassword "$env:WINDOWS_CERTIFICATE_PASSWORD" `
        -TimestampUrl $timestampUrl
    }
  } else {
    Write-Host "WINDOWS_CERTIFICATE_BASE64 or WINDOWS_CERTIFICATE_PASSWORD missing; skipping Windows signing."
  }
}

Write-Host "Windows platform validation passed."
