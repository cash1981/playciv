<#
Kopierer brikkegrafikken fra Civilization/Moderator inn i web-pakken, og skriver
et manifest med reelle bildestørrelser.

Manifestet havner i motoren, ikke i klienten, fordi serveren må kunne validere
at en brikke som legges ut faktisk peker på en kjent fil. Uten det kunne en
klient sende hvilken som helst streng som bildereferanse.

Selve PNG-ene havner i packages/web/public/board/ slik at Vite serverer dem.

Map-tiles er ikke med her — de er 21 MB og håndteres for seg.
#>
param(
    [string] $Source = (Join-Path $PSScriptRoot '..\Civilization\Moderator'),
    [string] $WebPublic = (Join-Path $PSScriptRoot '..\packages\web\public\board'),
    [string] $Manifest = (Join-Path $PSScriptRoot '..\packages\engine\data\board-assets.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Kildemappe -> kategori i paletten
$categories = [ordered] @{
    'figures'   = 'figure'
    'resources' = 'resource'
    'markers'   = 'marker'
    'cities'    = 'city'
    'buildings' = 'building'
}

$colours = @('blue', 'green', 'purple', 'red', 'yellow', 'white')

function Get-Label([string] $category, [string] $baseName) {
    $name = $baseName

    if ($category -eq 'figure' -or $category -eq 'city') {
        # "redcapitalwalled2" -> farge + resten
        $colour = $colours | Where-Object { $name.StartsWith($_) } | Select-Object -First 1
        if ($null -ne $colour) {
            $rest = $name.Substring($colour.Length) -replace '\d+$', ''
            $walled = $rest.EndsWith('walled')
            if ($walled) { $rest = $rest.Substring(0, $rest.Length - 'walled'.Length) }
            $label = (Get-Culture).TextInfo.ToTitleCase($colour) + ' ' + $rest
            if ($walled) { $label += ' (walled)' }
            return $label.Trim()
        }
    }

    # "Building Program" og "coin1" -> "Building Program", "Coin 1"
    $spaced = ($name -creplace '([a-z])([A-Z0-9])', '$1 $2')
    return (Get-Culture).TextInfo.ToTitleCase($spaced.ToLower()) -replace '\s+', ' '
}

$assets = @()

foreach ($folder in $categories.Keys) {
    $category = $categories[$folder]
    $from = Join-Path $Source $folder
    if (-not (Test-Path $from)) { throw "Fant ikke $from" }

    $to = Join-Path $WebPublic $folder
    New-Item -ItemType Directory -Path $to -Force | Out-Null

    # -Include krever wildcard i stien, så filtrer på Extension i stedet
    $files = Get-ChildItem $from -File | Where-Object { $_.Extension -in '.png', '.jpg' }
    foreach ($file in $files) {
        Copy-Item $file.FullName (Join-Path $to $file.Name) -Force

        $image = [System.Drawing.Image]::FromFile($file.FullName)
        try {
            $assets += [ordered] @{
                id       = "$folder/$($file.BaseName)"
                category = $category
                # Stien klienten laster fra, relativt til /board/
                path     = "$folder/$($file.Name)"
                label    = Get-Label $category $file.BaseName
                width    = $image.Width
                height   = $image.Height
            }
        } finally {
            $image.Dispose()
        }
    }

    Write-Host ("  {0,-10} {1,3} filer" -f $folder, (Get-ChildItem $to -File).Count)
}

$payload = [ordered] @{
    note   = 'Autogenerert av tools/board-assets.ps1. Rediger ikke manuelt.'
    source = 'Civilization/Moderator'
    assets = $assets
}

New-Item -ItemType Directory -Path (Split-Path $Manifest) -Force | Out-Null
$json = $payload | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText(
    (New-Item -ItemType File -Path $Manifest -Force).FullName,
    $json + "`n",
    (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`nSkrev $($assets.Count) brikker til $Manifest"
