$ErrorActionPreference = "Stop"

Set-Location "E:\Thesis\APPLICATION(APP)\MotionMirror (2)\MotionMirror"

$node = "C:\Users\u2011\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$next = ".\node_modules\next\dist\bin\next"

Write-Host "Starting MotionMirror on http://0.0.0.0:9002"
& $node $next dev -p 9002 -H 0.0.0.0
