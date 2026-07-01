param(
  [Parameter(Mandatory = $true)]
  [string] $BundleDir,

  [Parameter(Mandatory = $true)]
  [string] $CertificatePath,

  [Parameter(Mandatory = $true)]
  [string] $CertificatePassword,

  [string] $TimestampUrl = "http://timestamp.digicert.com"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $BundleDir -PathType Container)) {
  throw "bundle directory not found: $BundleDir"
}

if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
  throw "certificate file not found: $CertificatePath"
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($null -eq $signtool) {
  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitsRoot) {
    $signtool = Get-ChildItem -LiteralPath $kitsRoot -Filter signtool.exe -Recurse |
      Sort-Object FullName -Descending |
      Select-Object -First 1
  }
}

if ($null -eq $signtool) {
  throw "signtool.exe not found. Install Windows SDK on the runner."
}

$artifacts = @(
  Get-ChildItem -LiteralPath $BundleDir -Recurse -File |
    Where-Object { $_.Extension -in ".exe", ".msi" }
)

if ($artifacts.Count -eq 0) {
  throw "no .exe or .msi bundles found under $BundleDir"
}

foreach ($artifact in $artifacts) {
  & $signtool.FullName sign `
    /fd SHA256 `
    /td SHA256 `
    /tr $TimestampUrl `
    /f $CertificatePath `
    /p $CertificatePassword `
    $artifact.FullName
  & $signtool.FullName verify /pa /v $artifact.FullName
}

Write-Host "signed $($artifacts.Count) Windows bundle artifact(s) under $BundleDir"
