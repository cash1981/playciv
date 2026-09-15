<#
Copies the card artwork into the web package so the hand can be shown as cards
rather than as text, the way the AngularJS app did.

The names the client asks for come from `itemImage()` in the engine, which is a
faithful port of the Java `Image` implementations. Three of them do not match
the file on disk, because the spreadsheet and the artwork disagree. Those are
copied under both names rather than patching `itemImage()`, since the Java
behaviour is the reference.

The sources are spread over the old web repo and the reference material:

  old-civ-web/app/images/useritems  civs, culture, great persons, huts,
                                    villages, tiles, techs, policies, units
  Civilization/Moderator/city-states  cs1 - cs5
  Civilization/Moderator/wonders      the 27 wonders

Wonders had no image in Java at all; see the note in the README.
#>
param(
    [string] $UserItems = (Join-Path $PSScriptRoot '..\old-civ-web\app\images\useritems'),
    [string] $Moderator = (Join-Path $PSScriptRoot '..\Civilization\Moderator'),
    [string] $WebPublic = (Join-Path $PSScriptRoot '..\packages\web\public\items')
)

$ErrorActionPreference = 'Stop'

foreach ($path in @($UserItems, $Moderator)) {
    if (-not (Test-Path $path)) { throw "Could not find $path" }
}

New-Item -ItemType Directory -Path $WebPublic -Force | Out-Null

function Copy-Folder([string] $from, [string] $label) {
    $files = Get-ChildItem $from -File | Where-Object { $_.Extension -in '.png', '.jpg' }
    foreach ($file in $files) {
        Copy-Item $file.FullName (Join-Path $WebPublic $file.Name) -Force
    }
    Write-Host ("  {0,-12} {1,3} files" -f $label, $files.Count)
    return $files.Count
}

$total = 0
$total += Copy-Folder $UserItems 'useritems'
$total += Copy-Folder (Join-Path $Moderator 'city-states') 'city-states'

# Wonder files are lower case with no spaces and no leading "The", which is what
# `itemImage()` builds from the name. They are copied unchanged.
$total += Copy-Folder (Join-Path $Moderator 'wonders') 'wonders'

# Where the spreadsheet name and the artwork disagree, the engine asks for the
# spreadsheet spelling. Give it a copy under that name.
$aliases = [ordered] @{
    # "Expansionsim" is a typo in the Social Policy sheet
    'Expansionism.png'     = 'Expansionsim.png'
    # The Level 4 Tech sheet says "Replacement Parts", the card says "Replaceable"
    'ReplaceableParts.png' = 'ReplacementParts.png'
}

foreach ($from in $aliases.Keys) {
    $source = Join-Path $WebPublic $from
    if (-not (Test-Path $source)) { throw "Alias source $from is missing" }
    Copy-Item $source (Join-Path $WebPublic $aliases[$from]) -Force
    Write-Host ("  alias        {0} -> {1}" -f $from, $aliases[$from])
    $total++
}

Write-Host "`nWrote $total images to $WebPublic"
Write-Host 'Space Flight has no artwork: it is the level 5 tech added in code, not from the spreadsheet.'
