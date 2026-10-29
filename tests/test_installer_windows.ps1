# Testet den Windows-Installer mit Dummy-Verzeichnissen (ohne echtes OBS), läuft auch mit pwsh unter Linux/macOS.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$T = Join-Path ([IO.Path]::GetTempPath()) ("dc_onair_test_" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $T | Out-Null
$script:Fails = 0
function Check($name, $cond) { if ($cond) { Write-Host "ok     $name" } else { Write-Host "FEHLER $name"; $script:Fails++ } }

$env:DC_SKIP_OBS_CHECK = '1'
$env:DC_OBS_CONFIG = Join-Path $T 'obs studio'
$env:DC_APP_DIR = Join-Path $T 'dc "onair"'
$env:DC_FONT_DIR = Join-Path $T 'Fonts'
$env:DC_REC_DIR = Join-Path $T 'Videos'
foreach ($v in 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData') { Set-Item "env:$v" (Join-Path $T $v) }
$env:DC_FAKE_CAMERAS = 'iPhone von "Max"|Sony ILCE-7M2|Integrated Webcam'

New-Item -ItemType Directory $env:DC_OBS_CONFIG | Out-Null
[IO.File]::WriteAllText((Join-Path $env:DC_OBS_CONFIG 'global.ini'),
    "[General]`nFirstRun=true`n`n[Basic]`nProfile=Alt`nProfileDir=Alt`nSceneCollection=Alt`nSceneCollectionFile=Alt`n`n[Video]`nRenderer=Direct3D 11`n")

try {
    & (Join-Path $Root 'installer/install.ps1') -Yes -Platform twitch -Quality 1080p60 | Out-Null
    $sc = Join-Path $env:DC_OBS_CONFIG 'basic/scenes/dc_onair.json'
    $raw = [IO.File]::ReadAllText($sc)
    $doc = $raw | ConvertFrom-Json
    $bom = [IO.File]::ReadAllBytes($sc)[0] -eq 0xEF
    Check 'Szenen-Datei ist gültiges JSON ohne BOM' ($doc.name -eq 'dc_onair' -and -not $bom)
    Check 'keine ungefüllten Platzhalter' (-not $raw.Contains('{{'))
    $stinger = ($doc.transitions | Where-Object name -eq 'dc Stinger').settings.path
    Check 'Asset-Pfad korrekt (Vorwärts-Schrägstriche, Anführungszeichen escaped)' (Test-Path $stinger)
    $cam = ($doc.sources | Where-Object name -eq 'CAM iPhone').settings
    Check 'iPhone gebunden' ($cam.video_device_id -eq 'iPhone von "Max":')
    $sony = ($doc.sources | Where-Object name -eq 'CAM Sony A7 II').settings
    Check 'Sony gebunden' ($sony.video_device_id -eq 'Sony ILCE-7M2:')
    Check 'Standard-Variante ohne Move-Transition' (-not $raw.Contains('move_transition'))
    $p = Join-Path $env:DC_OBS_CONFIG 'basic/profiles/dc_onair'
    $ini = [IO.File]::ReadAllText((Join-Path $p 'basic.ini'))
    Check 'Profil: Bitrate und FPS' ($ini.Contains("VBitrate=6000") -and $ini.Contains('FPSCommon=60'))
    Check 'Profil: Aufnahmepfad' ($ini.Contains("FilePath=$($env:DC_REC_DIR.Replace('\','/'))"))
    Check 'Profil: Twitch ohne Schlüssel' ((Get-Content (Join-Path $p 'service.json') -Raw) -match 'Twitch' -and (Get-Content (Join-Path $p 'service.json') -Raw) -match '"key": ""')
    $g = [IO.File]::ReadAllText((Join-Path $env:DC_OBS_CONFIG 'global.ini'))
    Check 'global.ini aktiviert dc_onair' ($g.Contains('SceneCollection=dc_onair') -and $g.Contains('Profile=dc_onair'))
    Check 'global.ini: übrige Einstellungen erhalten' ($g.Contains('Renderer=Direct3D 11') -and ([regex]::Matches($g, '\[Basic\]')).Count -eq 1)
    Check 'global.ini gesichert' ((Get-ChildItem (Join-Path $env:DC_APP_DIR 'backups') -Recurse -Filter global.ini).Count -ge 1)

    # Zweiter Lauf: Move-Plugin und Schrift
    New-Item -ItemType Directory (Join-Path $env:APPDATA 'obs-studio/plugins/move-transition') -Force | Out-Null
    Copy-Item (Join-Path $Root 'payload/assets/branding/logo.png') (Join-Path $Root 'payload/assets/fonts/TestFont.ttf')
    & (Join-Path $Root 'installer/install.ps1') -Yes -Platform youtube -Quality 720p60 | Out-Null
    $raw2 = [IO.File]::ReadAllText($sc)
    Check '2. Lauf: Move-Variante' ($raw2.Contains('move_transition') -and $raw2.Contains('dc Move'))
    Check '2. Lauf: YouTube 720p60' ((Get-Content (Join-Path $p 'basic.ini') -Raw).Contains('OutputCY=720') -and (Get-Content (Join-Path $p 'service.json') -Raw).Contains('YouTube'))
    Check '2. Lauf: Schrift installiert' (Test-Path (Join-Path $env:DC_FONT_DIR 'TestFont.ttf'))
    Check '2. Lauf: Szenen gesichert' ((Get-ChildItem (Join-Path $env:DC_APP_DIR 'backups') -Recurse -Filter dc_onair.json).Count -ge 1)

    & (Join-Path $Root 'installer/install.ps1') -Yes -Uninstall | Out-Null
    Check 'Deinstallation entfernt Szenen, Profil, Assets' (-not (Test-Path $sc) -and -not (Test-Path $p) -and -not (Test-Path (Join-Path $env:DC_APP_DIR 'assets')))
    Check 'Deinstallation setzt OBS zurück' ([IO.File]::ReadAllText((Join-Path $env:DC_OBS_CONFIG 'global.ini')).Contains('SceneCollection=Untitled'))
} finally {
    Remove-Item (Join-Path $Root 'payload/assets/fonts/TestFont.ttf') -Force -ErrorAction SilentlyContinue
    Remove-Item $T -Recurse -Force -ErrorAction SilentlyContinue
}
if ($script:Fails -eq 0) { Write-Host 'Alle Prüfungen bestanden' } else { Write-Host "$($script:Fails) Prüfung(en) fehlgeschlagen"; exit 1 }
