$ErrorActionPreference = "Stop"

$nodeCandidates = @(
  (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$node = $nodeCandidates | Select-Object -First 1
if (-not $node) {
  throw "Node.js is required to run the MotionMirror LAN TURN relay."
}

$lanCandidates = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
  Where-Object { $_.OperationalStatus -eq "Up" } |
  ForEach-Object {
    $properties = $_.GetIPProperties()
    if ($properties.GatewayAddresses.Count -gt 0) {
      $properties.UnicastAddresses |
        Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        ForEach-Object { $_.Address.IPAddressToString }
    }
  }

$lanAddress = $lanCandidates |
  Where-Object { $_ -like "192.168.*" } |
  Select-Object -First 1
if (-not $lanAddress) {
  $lanAddress = $lanCandidates |
    Where-Object { $_ -like "10.*" -or $_ -match '^172\.(1[6-9]|2\d|3[01])\.' } |
    Select-Object -First 1
}
if (-not $lanAddress) {
  throw "No private LAN IPv4 address with a default gateway was found."
}

$serverScript = Join-Path $PSScriptRoot "native-turn\server.cjs"
$env:MOTIONMIRROR_TURN_LAN_ADDRESS = $lanAddress
$env:MOTIONMIRROR_LAN_ADDRESS = $lanAddress

$docker = Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $docker) {
  $dockerFallback = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  if (Test-Path -LiteralPath $dockerFallback) {
    $docker = $dockerFallback
  }
}

if ($docker) {
  $composeFile = Join-Path $PSScriptRoot "coturn-compose.yml"
  & $docker compose -f $composeFile -p motionmirror-relay up -d --force-recreate
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "TCP TURN relay could not start; continuing with the UDP relay."
  }
}

Write-Output "Starting MotionMirror TURN relay at turn:${lanAddress}:443 (TCP/UDP) and turn:${lanAddress}:3478 (UDP)."
& $node $serverScript
