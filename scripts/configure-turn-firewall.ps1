$ErrorActionPreference = "Stop"

$udpRuleName = "MotionMirror TURN UDP (Local subnet)"
$tcpRuleName = "MotionMirror TURN TCP (Local subnet)"

if (-not (Get-NetFirewallRule -DisplayName $udpRuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule `
    -DisplayName $udpRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol UDP `
    -LocalPort 443,3478,49160-49250 `
    -RemoteAddress LocalSubnet `
    -Profile Any | Out-Null
}

if (-not (Get-NetFirewallRule -DisplayName $tcpRuleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule `
    -DisplayName $tcpRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 443 `
    -RemoteAddress LocalSubnet `
    -Profile Any | Out-Null
}

Write-Output "MotionMirror TURN firewall access is enabled for the local subnet."
