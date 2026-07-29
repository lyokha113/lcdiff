param([Parameter(Mandatory = $true)][string] $Path)
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Path))
$peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
$optionalHeaderOffset = $peOffset + 24
$subsystem = [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset + 68)
if ($subsystem -ne 2) {
  throw "expected IMAGE_SUBSYSTEM_WINDOWS_GUI (2), got $subsystem for $Path"
}
Write-Host "Windows GUI subsystem verified: $Path"
