# Fetch Gradle without relying on the wrapper's single-shot download.
#
# gradlew downloads the distribution once, with no resume and no retry, and
# from this network that transfer resets partway through every time. This
# script instead resumes, restarts stalled connections, and rotates mirrors.
#
# Kept outside the repository: ~130MB of build tooling, not source.
#
# Measured throughput from this machine (30s probe, 4MB range):
#   tencent   31 KB/s   <- the only usable one
#   nju        6 KB/s
#   ustc       5 KB/s
#   huawei     2 KB/s
#   tuna/sjtu/bfsu/aliyun  fail or return an error page
# Everything is therefore tried in cost order, and a stalled connection is
# dropped early rather than waited on, because the fast mirror is also erratic:
# it transfers happily and then stops dead.
param(
  [string]$Version = "8.14.3",
  [string]$InstallRoot = "$env:USERPROFILE\.gradle-dists",
  [int]$MaxMinutes = 90
)

$ErrorActionPreference = "Stop"

$zip       = Join-Path $InstallRoot "gradle-$Version-bin.zip"
$unpacked  = Join-Path $InstallRoot "gradle-$Version"
$gradleBat = Join-Path $unpacked "bin\gradle.bat"

if (Test-Path $gradleBat) {
  Write-Host "[gradle] already installed: $gradleBat"
  exit 0
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

# The wrapper already left a partial copy behind; reuse those bytes rather
# than fetching them twice.
$stale = Join-Path "$env:USERPROFILE\.gradle\wrapper\dists" "gradle-$Version-bin"
if (-not (Test-Path $zip) -and (Test-Path $stale)) {
  $part = Get-ChildItem $stale -Recurse -Filter "*.zip.part" -ErrorAction SilentlyContinue |
          Sort-Object Length -Descending | Select-Object -First 1
  if ($part -and $part.Length -gt 1MB) {
    Copy-Item $part.FullName $zip
    Write-Host "[gradle] reusing $([math]::Round($part.Length/1MB,1)) MB from a previous attempt"
  }
}

$mirrors = @(
  "https://mirrors.cloud.tencent.com/gradle/gradle-$Version-bin.zip",
  "https://mirrors.nju.edu.cn/gradle/gradle-$Version-bin.zip",
  "https://mirrors.ustc.edu.cn/gradle/gradle-$Version-bin.zip",
  "https://mirrors.huaweicloud.com/gradle/gradle-$Version-bin.zip"
)

# Trustworthy size, so a truncated file that curl happily reports as success is
# not mistaken for a complete one.
$expected = 0
try {
  $head = & curl.exe -sSI -L --connect-timeout 15 $mirrors[0]
  $lenLine = $head | Where-Object { $_ -match '^content-length:\s*(\d+)' } | Select-Object -Last 1
  if ($lenLine) { $expected = [int64]$Matches[1] }
} catch { }
if ($expected -le 0) { $expected = 130MB }
Write-Host "[gradle] expecting $([math]::Round($expected/1MB,1)) MB"

$deadline = (Get-Date).AddMinutes($MaxMinutes)
$done = $false

while (-not $done -and (Get-Date) -lt $deadline) {
  $have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
  if ($have -ge $expected) { $done = $true; break }

  $m = $mirrors[0]   # fastest host first; rotate only if it keeps failing
  $pct = [math]::Round(100 * $have / $expected)
  Write-Host ("[gradle] {0,3}%  {1,7:N1} MB  <- {2}" -f $pct, ($have/1MB), ([uri]$m).Host)

  # -C - resumes. --speed-limit/--speed-time aborts a connection that stalls,
  # which matters more than the retry count: the mirror frequently stops
  # transferring without closing the socket.
  & curl.exe -L --fail -C - `
             --retry 5 --retry-delay 4 --retry-all-errors `
             --speed-limit 3000 --speed-time 45 `
             --connect-timeout 20 `
             -o $zip $m

  $have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
  if ($have -ge $expected) { $done = $true }
  elseif ($have -le 0) {
    # No progress at all from the primary; demote it and try the next.
    if ($mirrors.Count -gt 1) {
      $primary = $mirrors[0]
      $mirrors = $mirrors[1..($mirrors.Count-1)] + $primary
      Write-Host "[gradle] no progress, rotating mirrors"
    }
  }
}

$have = if (Test-Path $zip) { (Get-Item $zip).Length } else { 0 }
if (-not $done) {
  Write-Error "[gradle] only got $([math]::Round($have/1MB,1)) MB of $([math]::Round($expected/1MB,1)) MB within $MaxMinutes min"
  exit 1
}

Write-Host "[gradle] downloaded $([math]::Round($have/1MB,1)) MB, extracting..."
if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $InstallRoot -Force

if (-not (Test-Path $gradleBat)) {
  Write-Error "[gradle] archive extracted but gradle.bat is missing"
  exit 1
}

Write-Host "[gradle] ready: $gradleBat"