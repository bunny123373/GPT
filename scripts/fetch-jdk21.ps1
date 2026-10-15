# Fetch a JDK 21 for the Android build.
#
# Capacitor 8's Android module compiles at Java 21 (sourceCompatibility /
# targetCompatibility VERSION_21 in both capacitor.build.gradle and
# node_modules/@capacitor/android/capacitor/build.gradle). Only JDK 17 is
# installed here, so `assembleRelease` fails with "invalid source release: 21"
# before it produces anything.
#
# Written to the user's own tools directory rather than Program Files, so no
# installer and no elevation are needed, and so it cannot disturb the JDK 17
# that other projects on this machine depend on.
#
# download.java.net is the fastest reachable host by a wide margin (63 KB/s
# measured; the nearest alternative was 5 KB/s). The distribution is used in
# place via -Dorg.gradle.java.home rather than being put on PATH.
param(
  [string]$Url = "https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_windows-x64_bin.zip",
  [string]$InstallRoot = "$env:USERPROFILE\.jdk-dists",
  [int]$MaxMinutes = 90
)

$ErrorActionPreference = "Stop"

$zip = Join-Path $InstallRoot "jdk21.zip"
$dir = Join-Path $InstallRoot "jdk-21.0.2"

if (Test-Path (Join-Path $dir "bin\java.exe")) {
  Write-Host "[jdk] already installed"
  exit 0
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

# ~190 MB, so anything less than this is a truncated file.
$expected = 195MB
$deadline = (Get-Date).AddMinutes($MaxMinutes)
$done = $false

while (-not $done -and (Get-Date) -lt $deadline) {
  $have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
  if ($have -ge $expected) { $done = $true; break }

  $pct = [math]::Round(100 * $have / $expected)
  Write-Host ("[jdk] {0,3}%  {1,6:N1} MB" -f $pct, ($have/1MB))

  # Resume, and drop a connection that stalls rather than sitting on it.
  & curl.exe -L --fail -C - `
             --retry 5 --retry-delay 4 --retry-all-errors `
             --speed-limit 3000 --speed-time 45 `
             --connect-timeout 20 `
             -o $zip $Url

  $have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
  if ($have -ge $expected) { $done = $true }
}

$have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
if (-not $done) {
  Write-Error "[jdk] only got $([math]::Round($have/1MB,1)) MB within $MaxMinutes min"
  exit 1
}

Write-Host "[jdk] extracting $([math]::Round($have/1MB,1)) MB..."
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $InstallRoot -Force

# The zip contains a single versioned directory; flatten it so the path is stable.
$inner = Get-ChildItem $InstallRoot -Directory | Where-Object { $_.Name -like "jdk-21*" } | Select-Object -First 1
if ($inner -and $inner.FullName -ne $dir) {
  Rename-Item $inner.FullName $dir
}

$javaExe = Join-Path $dir "bin\java.exe"
if (-not (Test-Path $javaExe)) {
  Write-Error "[jdk] extracted but $javaExe is missing"
  exit 1
}

Write-Host "[jdk] ready: $javaExe"
& $javaExe -version 2>&1 | ForEach-Object { Write-Host "       $_" }