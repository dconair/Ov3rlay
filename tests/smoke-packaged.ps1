# Smoke-Test des gebauten Windows-Installers: stille Installation, dann die gepackte CLI (Electron als Node) gegen Dummy-Ordner.
$ErrorActionPreference = 'Stop'
$setup = (Get-ChildItem dist -Filter 'dc_onair-Setup-*-windows.exe' | Select-Object -First 1).FullName
Write-Host "Installer: $setup ($([math]::Round((Get-Item $setup).Length / 1MB, 1)) MB)"
Start-Process $setup -ArgumentList '/S' -Wait
$app = Join-Path $env:LOCALAPPDATA 'Programs\dc_onair Setup'
$exe = Join-Path $app 'dc_onair Setup.exe'
if (-not (Test-Path $exe)) { throw "App nicht installiert: $exe" }
$res = Join-Path $app 'resources'
foreach ($f in 'payload\brand.env', 'payload\assets\video\stinger.webm', 'payload\scenes\dc_onair.windows.json', 'app.asar') {
    if (-not (Test-Path (Join-Path $res $f))) { throw "fehlt im Paket: $f" }
}

$t = Join-Path $env:RUNNER_TEMP 'dcsmoke'
Remove-Item $t -Recurse -Force -ErrorAction SilentlyContinue
$env:DC_OBS_CONFIG = Join-Path $t 'OBS Studio'; $env:DC_APP_DIR = Join-Path $t 'dc onair'
$env:DC_FONT_DIR = Join-Path $t 'Fonts'; $env:DC_REC_DIR = Join-Path $t 'Videos'
$env:ELECTRON_RUN_AS_NODE = '1'
$cli = Join-Path $res 'app.asar\cli\dc-onair.js'
$payload = Join-Path $res 'payload'
function Dc { & $exe $cli @args --payload $payload; if ($LASTEXITCODE -ne 0) { throw "CLI-Fehler ($args)" } }

Dc status
Dc encoder
Dc cameras
Dc matrix | Out-Null
Dc install --service twitch --quality 1080p30
$scene = Join-Path $env:DC_OBS_CONFIG 'basic\scenes\dc_onair.json'
$text = Get-Content $scene -Raw
if ($text.Contains('{{')) { throw 'offene Platzhalter in der Szenen-Datei' }
$doc = $text | ConvertFrom-Json
$stinger = ($doc.transitions | Where-Object { $_.id -eq 'obs_stinger_transition' }).settings.path
if (-not (Test-Path $stinger)) { throw "Stinger-Datei fehlt: $stinger" }
if (-not (Select-String -Path (Join-Path $env:DC_OBS_CONFIG 'basic\profiles\dc_onair\basic.ini') -Pattern '^StreamEncoder=')) { throw 'Encoder fehlt im Profil' }
Dc uninstall
if (Test-Path $scene) { throw 'Szene nach Deinstallation noch vorhanden' }
Write-Host 'Smoke-Test bestanden'
