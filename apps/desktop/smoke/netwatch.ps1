# Network watcher for the privacy smoke test (S8.3). Polls a process tree's sockets about every
# 250 ms until the stop file appears or the root process exits, and writes one JSON line per new
# outside connection: the owning process, its WebView2 process type and the remote address.
# Loopback connections (the dead proxy, the test's debugging port) are not outside.
#   powershell -File netwatch.ps1 -RootPid <pid> -Out <file> -Stop <file>
param([int]$RootPid, [string]$Out, [string]$Stop)
$seen = @{}
'' | Out-File -FilePath $Out -Encoding utf8
while ((Get-Process -Id $RootPid -ErrorAction SilentlyContinue) -and -not (Test-Path $Stop)) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine
  $ids = @($RootPid)
  do { $n = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -gt $n)
  foreach ($c in (Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })) {
    if ($c.RemoteAddress -match '^(127\.|::1$|0\.0\.0\.0$|::$)') { continue }
    $key = "$($c.OwningProcess) $($c.RemoteAddress):$($c.RemotePort)"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = 1
    $owner = $all | Where-Object { $_.ProcessId -eq $c.OwningProcess } | Select-Object -First 1
    $cl = [string]$owner.CommandLine
    $type = if ($cl -match '--type=([\w-]+)') { $Matches[1] } elseif ($owner.Name -eq 'msedgewebview2.exe') { 'browser' } else { 'host' }
    @{ process = [string]$owner.Name; type = $type; remote = "$($c.RemoteAddress)"; port = [int]$c.RemotePort } | ConvertTo-Json -Compress | Out-File -FilePath $Out -Append -Encoding utf8
  }
  Start-Sleep -Milliseconds 250
}
