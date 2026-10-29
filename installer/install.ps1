# dc_onair OBS-Setup für Windows: richtet Szenen, Übergänge, Profil und Assets in OBS ein.
# Aufruf: Install-Windows.bat (Doppelklick) oder  powershell -ExecutionPolicy Bypass -File installer\install.ps1 [-Yes] [-Uninstall]
# Läuft mit dem in Windows 10/11 enthaltenen Windows PowerShell 5.1. Datei muss als UTF-8 mit BOM gespeichert bleiben.
param(
    [switch]$Yes,
    [switch]$Uninstall,
    [ValidateSet('', 'twitch', 'youtube', 'custom')][string]$Platform = '',
    [ValidateSet('', '1080p60', '1080p30', '720p60')][string]$Quality = ''
)
$ErrorActionPreference = 'Stop'

$PkgDir = Split-Path -Parent $PSScriptRoot
$Payload = Join-Path $PkgDir 'payload'

# Überschreibbar für Tests
function Get-Setting($name, $default) { $v = [Environment]::GetEnvironmentVariable($name); if ($v) { $v } else { $default } }
$ObsDir = Get-Setting 'DC_OBS_DIR' ''
$ObsConfig = Get-Setting 'DC_OBS_CONFIG' (Join-Path $env:APPDATA 'obs-studio')
$AppDir = Get-Setting 'DC_APP_DIR' (Join-Path $env:APPDATA 'dc_onair')
$FontDir = Get-Setting 'DC_FONT_DIR' (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts')
$RecDir = Get-Setting 'DC_REC_DIR' ([Environment]::GetFolderPath('MyVideos'))
$SkipObsCheck = [bool][Environment]::GetEnvironmentVariable('DC_SKIP_OBS_CHECK')

$Utf8 = New-Object System.Text.UTF8Encoding $false
function Read-Text($path) { ([IO.File]::ReadAllText($path, $Utf8)) -replace "`r`n", "`n" }
function Write-Text($path, $text) { [IO.File]::WriteAllText($path, $text, $Utf8) }

function Say($t) { Write-Host $t }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!] $t" -ForegroundColor Yellow }
function Step($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan }
function Fail($t) { Write-Host ""; Write-Host "Fehler: $t" -ForegroundColor Red; exit 1 }

function Ask($question, $default) {
    if ($Yes) { return "$default" }
    $answer = Read-Host "  $question [$default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return "$default" }
    return $answer.Trim()
}
function Ask-Yes($question, $default) { (Ask "$question (j/n)" $default) -match '^(j|ja|y|yes)$' }

function Brand-Value($key) {
    foreach ($line in (Read-Text (Join-Path $Payload 'brand.env')).Split("`n")) {
        if ($line.StartsWith("$key=")) { return $line.Substring($key.Length + 1).Trim() }
    }
    return ''
}

function Json-Escape($s) { "$s".Replace('\', '\\').Replace('"', '\"') }

function Render($templatePath, $targetPath, $tokens) {
    $text = Read-Text $templatePath
    foreach ($key in $tokens.Keys) { $text = $text.Replace("{{$key}}", [string]$tokens[$key]) }
    Write-Text $targetPath $text
}

function Ini-Set($file, $section, $key, $value) {
    $lines = @()
    if (Test-Path $file) { $lines = @((Read-Text $file).Split("`n")) }
    $out = New-Object System.Collections.ArrayList
    $inSection = $false; $done = $false; $seen = $false
    foreach ($line in $lines) {
        if ($line.StartsWith('[')) {
            if ($inSection -and -not $done) { [void]$out.Add("$key=$value"); $done = $true }
            $inSection = ($line.Trim() -eq "[$section]")
            if ($inSection) { $seen = $true }
        } elseif ($inSection -and $line.StartsWith("$key=")) {
            [void]$out.Add("$key=$value"); $done = $true; continue
        }
        [void]$out.Add($line)
    }
    while ($out.Count -gt 0 -and $out[$out.Count - 1] -eq '') { $out.RemoveAt($out.Count - 1) }
    if (-not $seen) { [void]$out.Add(''); [void]$out.Add("[$section]"); [void]$out.Add("$key=$value") }
    elseif ($inSection -and -not $done) { [void]$out.Add("$key=$value") }
    Write-Text $file (($out -join "`n") + "`n")
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $AppDir "backups\$Stamp"
$script:BackedUp = $false
function Backup($path) {
    if (-not (Test-Path $path)) { return }
    New-Item -ItemType Directory -Force $BackupDir | Out-Null
    Copy-Item $path (Join-Path $BackupDir (Split-Path -Leaf $path)) -Recurse -Force
    $script:BackedUp = $true
}

function Find-Obs {
    if ($ObsDir) { return $ObsDir }
    foreach ($candidate in @(
            (Get-ItemProperty 'HKLM:\SOFTWARE\OBS Studio' -ErrorAction SilentlyContinue).'(default)',
            (Join-Path $env:ProgramFiles 'obs-studio'))) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'bin\64bit\obs64.exe'))) { return $candidate }
    }
    return $null
}

function Move-Plugin-Installed {
    $dirs = @((Join-Path $env:ProgramFiles 'obs-studio\obs-plugins\64bit'), (Join-Path $env:ProgramData 'obs-studio\plugins'),
        (Join-Path $env:APPDATA 'obs-studio\plugins'), (Join-Path $ObsConfig 'plugins'))
    foreach ($dir in $dirs) {
        if ((Test-Path $dir) -and (Get-ChildItem $dir -Filter '*move*transition*' -ErrorAction SilentlyContinue)) { return $true }
    }
    return $false
}

function Get-Cameras {
    if ($env:DC_FAKE_CAMERAS) { return @($env:DC_FAKE_CAMERAS.Split('|')) }
    try {
        return @(Get-PnpDevice -PresentOnly -ErrorAction Stop |
            Where-Object { ($_.Class -in @('Camera', 'Image')) -and $_.FriendlyName } |
            ForEach-Object { $_.FriendlyName } | Sort-Object -Unique)
    } catch { return @() }
}

# Gibt den Namen der gewählten Kamera zurück (oder '')
function Pick-Camera($label, $cameras, $pattern) {
    $guess = 0
    for ($i = 0; $i -lt $cameras.Count; $i++) { if ($guess -eq 0 -and $cameras[$i] -match $pattern) { $guess = $i + 1 } }
    $answer = Ask "${label}: Nummer oder Gerätename eingeben, 0 = später in OBS auswählen" $guess
    $name = ''
    if ($answer -match '^\d+$') {
        $n = [int]$answer
        if ($n -ge 1 -and $n -le $cameras.Count) { $name = $cameras[$n - 1] }
    } else { $name = $answer }
    if ($name) { Ok "${label}: $name" } else { Say "  ${label}: wird später in OBS ausgewählt" }
    return $name
}

# --- Ablauf -----------------------------------------------------------------------
if (-not (Test-Path $Payload)) { Fail "Ordner 'payload' nicht gefunden. Bitte das gesamte Paket entpacken." }
$Collection = Brand-Value 'COLLECTION'
$BrandName = Brand-Value 'NAME'

Say "$BrandName OBS-Setup"
Say 'Richtet Szenen, Übergänge, Effekte und ein Streaming-Profil in OBS ein.'

Step '1/5  OBS prüfen'
if (-not $SkipObsCheck) {
    $found = Find-Obs
    if (-not $found) { Fail 'OBS wurde nicht gefunden. Bitte zuerst OBS von https://obsproject.com installieren.' }
    $version = (Get-Item (Join-Path $found 'bin\64bit\obs64.exe')).VersionInfo.ProductVersion
    Ok "OBS $version gefunden"
    while (Get-Process obs64 -ErrorAction SilentlyContinue) {
        Warn 'OBS läuft noch. Bitte OBS beenden, sonst überschreibt es die neuen Einstellungen.'
        if ($Yes) { Fail 'OBS ist geöffnet.' }
        Read-Host '  Weiter mit Enter' | Out-Null
    }
}
New-Item -ItemType Directory -Force (Join-Path $ObsConfig 'basic\scenes'), (Join-Path $ObsConfig 'basic\profiles') | Out-Null

if ($Uninstall) {
    Step 'Entfernen'
    $sceneFile = Join-Path $ObsConfig "basic\scenes\$Collection.json"
    Backup $sceneFile
    Remove-Item $sceneFile -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $ObsConfig "basic\profiles\$Collection") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $AppDir 'assets') -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($f in 'global.ini', 'user.ini') {
        $path = Join-Path $ObsConfig $f
        if (Test-Path $path) { foreach ($key in 'Profile', 'ProfileDir', 'SceneCollection', 'SceneCollectionFile') { Ini-Set $path 'Basic' $key 'Untitled' } }
    }
    Ok "$BrandName wurde aus OBS entfernt. Sicherungen liegen unter $AppDir\backups"
    exit 0
}

Step '2/5  Streaming-Einstellungen'
if (-not $Platform) {
    Say '  1 = Twitch   2 = YouTube   3 = Anderer Dienst (Server und Schlüssel später in OBS)'
    $Platform = switch (Ask 'Plattform' '1') { '2' { 'youtube' } '3' { 'custom' } default { 'twitch' } }
}
if (-not $Quality) {
    Say '  1 = 1080p60   2 = 1080p30   3 = 720p60'
    $Quality = switch (Ask 'Qualität' '1') { '2' { '1080p30' } '3' { '720p60' } default { '1080p60' } }
}
# Bitraten nach den Empfehlungen von Twitch bzw. YouTube (kbit/s)
$twitch = ($Platform -eq 'twitch')
switch ($Quality) {
    '1080p60' { $OutW = 1920; $OutH = 1080; $Fps = 60; $Bitrate = if ($twitch) { 6000 } else { 9000 } }
    '1080p30' { $OutW = 1920; $OutH = 1080; $Fps = 30; $Bitrate = if ($twitch) { 4500 } else { 6000 } }
    '720p60'  { $OutW = 1280; $OutH = 720;  $Fps = 60; $Bitrate = if ($twitch) { 4500 } else { 6000 } }
}
Ok "$Platform, $Quality, $Bitrate kbit/s"

Step '3/5  Kameras'
$cameras = @(Get-Cameras)
if ($cameras.Count -gt 0) {
    for ($i = 0; $i -lt $cameras.Count; $i++) { Say "  $($i + 1) = $($cameras[$i])" }
} else {
    Warn 'Keine Kamera erkannt. iPhone und Sony werden später in OBS ausgewählt (Rechtsklick auf die Quelle, Eigenschaften).'
}
$iphoneName = Pick-Camera 'iPhone (kabellos über Camo, Iriun, EpocCam o. ä.)' $cameras 'iphone|camo|iriun|epoccam'
$sonyName = Pick-Camera 'Sony A7 II (USB-Webcam-Modus oder Capture-Karte)' $cameras 'sony|ilce|a7|imaging edge|capture|cam link|elgato'

Step '4/5  Installieren'
$variant = 'windows'
if (Move-Plugin-Installed) { $variant = 'windows.move'; Ok "Plugin 'Move Transition' erkannt, fließende Kamerawechsel aktiv" }

New-Item -ItemType Directory -Force $AppDir | Out-Null
$assets = Join-Path $AppDir 'assets'
Backup $assets
if (Test-Path $assets) { Remove-Item $assets -Recurse -Force }
Copy-Item (Join-Path $Payload 'assets') $assets -Recurse
Remove-Item (Join-Path $assets 'fonts\HIER_SCHRIFTEN_ABLEGEN.txt') -Force -ErrorAction SilentlyContinue
Ok "Grafiken und Videos nach $assets kopiert"

$fontFace = 'Segoe UI'
$fonts = @(Get-ChildItem (Join-Path $assets 'fonts') -Include *.ttf, *.otf -Recurse -ErrorAction SilentlyContinue)
if ($fonts.Count -gt 0) {
    New-Item -ItemType Directory -Force $FontDir | Out-Null
    foreach ($font in $fonts) {
        Copy-Item $font.FullName $FontDir -Force
        if (-not $env:DC_FONT_DIR) {
            $type = if ($font.Extension -ieq '.otf') { 'OpenType' } else { 'TrueType' }
            New-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts' -Name "$($font.BaseName) ($type)" `
                -Value (Join-Path $FontDir $font.Name) -PropertyType String -Force | Out-Null
        }
    }
    if (Brand-Value 'FONT_FAMILY') { $fontFace = Brand-Value 'FONT_FAMILY' }
    Ok "Markenschrift installiert: $fontFace"
}

# Gerätename ohne Pfad; OBS ordnet die Kamera darüber zu. Falls nicht, in OBS einmal Gerät wählen.
function Dshow-Id($name) { if ($name) { "${name}:" } else { '' } }
$tokens = [ordered]@{
    ASSETS          = Json-Escape ($assets.Replace('\', '/'))
    FONT_FACE       = Json-Escape $fontFace
    CAM_IPHONE_ID   = Json-Escape (Dshow-Id $iphoneName)
    CAM_IPHONE_NAME = Json-Escape $iphoneName
    CAM_SONY_ID     = Json-Escape (Dshow-Id $sonyName)
    CAM_SONY_NAME   = Json-Escape $sonyName
}
$sceneFile = Join-Path $ObsConfig "basic\scenes\$Collection.json"
Backup $sceneFile
Render (Join-Path $Payload "scenes\$Collection.$variant.json") $sceneFile $tokens
Ok "Szenen-Collection '$Collection' installiert"

$profileDir = Join-Path $ObsConfig "basic\profiles\$Collection"
Backup $profileDir
New-Item -ItemType Directory -Force $profileDir | Out-Null
Render (Join-Path $Payload 'profile\basic.ini.tmpl') (Join-Path $profileDir 'basic.ini') @{
    NAME = $Collection; OUT_W = $OutW; OUT_H = $OutH; FPS = $Fps; BITRATE = $Bitrate; REC_PATH = $RecDir.Replace('\', '/') }
Copy-Item (Join-Path $Payload "profile\service.$Platform.json") (Join-Path $profileDir 'service.json') -Force
Ok "Profil '$Collection' ($Quality, Aufnahmen in $RecDir) angelegt"

foreach ($f in 'global.ini', 'user.ini') {
    $path = Join-Path $ObsConfig $f
    if (-not (Test-Path $path)) {
        if ($f -eq 'user.ini') { continue }
        Ini-Set $path 'General' 'FirstRun' 'true'
    } else { Backup $path }
    Ini-Set $path 'Basic' 'Profile' $Collection
    Ini-Set $path 'Basic' 'ProfileDir' $Collection
    Ini-Set $path 'Basic' 'SceneCollection' $Collection
    Ini-Set $path 'Basic' 'SceneCollectionFile' $Collection
}
Ok "OBS startet künftig mit $Collection"
if ($script:BackedUp) { Say "  Vorherige Dateien gesichert unter $BackupDir" }

Step '5/5  Fertig'
if ($variant -eq 'windows' -and -not $Yes) {
    if (Ask-Yes "Plugin 'Move Transition' (weiche Kamerawechsel) jetzt herunterladen? Danach dieses Setup erneut starten" 'n') {
        Start-Process 'https://obsproject.com/forum/resources/move-transition.913/'
    }
}
Say @"

Noch zu tun in OBS:
  1. Einstellungen > Stream: Konto verbinden bzw. Stream-Schlüssel eintragen (wird nicht gespeichert).
  2. Windows fragt ggf. nach Kamera- und Mikrofonzugriff: erlauben
     (Einstellungen > Datenschutz und Sicherheit).
  3. Kameras prüfen: Quellen 'CAM iPhone' und 'CAM Sony A7 II' > Eigenschaften > Gerät wählen.
  4. Eigenes Logo, Schrift, Hintergründe: siehe README.

Szenen-Hotkeys: Strg+Alt+1 bis 8, Lower Third Strg+Alt+L (an) / H (aus), Mikro stumm Strg+Alt+M
"@
if (-not $Yes -and -not $SkipObsCheck) {
    if (Ask-Yes 'OBS jetzt starten?' 'j') {
        $found = Find-Obs
        Start-Process (Join-Path $found 'bin\64bit\obs64.exe') -WorkingDirectory (Join-Path $found 'bin\64bit')
    }
}
