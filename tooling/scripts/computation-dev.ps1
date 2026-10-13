param([switch]$Setup, [switch]$Test, [switch]$Check)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskService = Join-Path $taskRoot 'services/computation'
$taskPython = Join-Path $taskService '.venv/Scripts/python.exe'
if ($Setup) {
  python -m venv (Join-Path $taskService '.venv')
  & $taskPython -m pip install -r (Join-Path $taskService 'requirements-dev.lock')
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
if ($Check) { & $taskPython (Join-Path $taskService 'generate_models.py') --check; exit $LASTEXITCODE }
if ($Test) { & $taskPython -m pytest $taskService; exit $LASTEXITCODE }
Push-Location $taskService
try { & $taskPython -m uvicorn app:app --host 127.0.0.1 --port 8000 --no-access-log }
finally { Pop-Location }
