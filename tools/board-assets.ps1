<#
Copies the piece artwork from Civilization/Moderator into the web package and
writes a manifest with the real image sizes.

The manifest goes in the engine rather than the client, because the server has
to be able to check that a piece being placed really points at a known file.
Without it a client could send any string at all as an image reference.

The PNGs themselves land in packages/web/public/board/ so Vite serves them.
#>
param(
    [string] $Source = (Join-Path $PSScriptRoot '..\Civilization\Moderator'),
    [string] $WebPublic = (Join-Path $PSScriptRoot '..\packages\web\public\board'),
    [string] $Manifest = (Join-Path $PSScriptRoot '..\packages\engine\data\board-assets.json')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# Source folder -> palette category. Tiles split in two because they are used
# differently: civtile is a starting tile, tile is a numbered exploration tile.
$categories = [ordered] @{
    'figures'   = 'figure'
    'resources' = 'resource'
    'markers'   = 'marker'
    'cities'    = 'city'
    'buildings' = 'building'
    'tiles'     = 'tile'
    'leaders'   = 'leader'
    'wonders'   = 'wonder'
}

# A map tile covers 4 x 4 squares of 94 pixels. The source images are 375 x 375,
# so one pixel narrow; they are scaled to 376 to line up with the grid.
$TILE_PIXELS = 376

# Leader markers sit on the culture track, whose cells are about 52 pixels wide
# once the track image is scaled to the width of the map. The sources are 65
# wide, so they are scaled down to leave a little air on each side of a cell.
$LEADER_WIDTH = 46

# Wonders sit in the shared Wonders area and tidy into its 94-pixel grid. Most
# of the source images are ~85 px, but a few are up to 117; cap the longer side
# at 90 (keeping aspect) so none overlaps its neighbour or overhangs the board.
$WONDER_MAX = 90

# The civilisations starting tiles. The rest of tiles/ are exploration tiles.
$civTiles = @(
    'america', 'arabia', 'Aztec', 'china', 'egypt', 'England', 'France', 'germany',
    'greece', 'india', 'japan', 'mongolia', 'rome', 'russia', 'spain', 'Zulu'
)

$colours = @('blue', 'green', 'purple', 'red', 'yellow', 'white')

# The wonder art (Moderator/wonders) is named lower case with no spaces, no
# leading "The" and hyphens stripped, matching `itemImage()` in the engine. The
# proper names are written out so the palette label reads well rather than
# "Greatlighthouse". Keys are the file base names.
$wonderLabels = @{
    'angkorwat'           = 'Angkor Wat'
    'bigben'              = 'Big Ben'
    'brandenburggate'     = 'Brandenburg Gate'
    'chichenitza'         = 'Chichen Itza'
    'colossus'            = 'The Colossus'
    'cristoredentor'      = 'Cristo Redentor'
    'greatlighthouse'     = 'The Great Lighthouse'
    'greatwall'           = 'The Great Wall'
    'hanginggardens'      = 'The Hanging Gardens'
    'himejisamuraicastle' = 'Himeji Samurai Castle'
    'internet'            = 'The Internet'
    'kremlin'             = 'The Kremlin'
    "leonardo'sworkshop"  = "Leonardo's Workshop"
    'louvre'              = 'The Louvre'
    'machupichu'          = 'Machu Pichu'
    'notredame'           = 'Notre-Dame'
    'oracle'              = 'The Oracle'
    'panamacanal'         = 'Panama Canal'
    'pentagon'            = 'The Pentagon'
    'porcelaintower'      = 'Porcelain Tower'
    'pyramids'            = 'The Pyramids'
    'statueofliberty'     = 'Statue of Liberty'
    'statueofzeus'        = 'Statue of Zeus'
    'stonehenge'          = 'Stonehenge'
    'sydneyoperahouse'    = 'Sydney Opera House'
    'tajmahal'            = 'Taj Mahal'
    'unitednations'       = 'United Nations'
}

# Pieces to leave out of the manifest even though the source art exists, keyed by
# "<folder>/<basename>". The white army (barbarians) was dropped as unused; see
# issue #26.
$exclude = @('figures/whitearmy')

function Get-Label([string] $category, [string] $baseName) {
    $name = $baseName

    if ($category -eq 'wonder') {
        $key = $baseName.ToLower()
        if ($wonderLabels.ContainsKey($key)) { return $wonderLabels[$key] }
    }

    if ($category -eq 'leader') {
        # "japanese_red" -> "Japanese (Red)". The source names mix casing, so
        # everything is lowercased before being title cased again.
        $parts = $name.Split('_')
        $leader = (Get-Culture).TextInfo.ToTitleCase($parts[0].ToLower())
        $colour = (Get-Culture).TextInfo.ToTitleCase($parts[-1].ToLower())
        return "$leader ($colour)"
    }

    if ($category -eq 'figure' -or $category -eq 'city') {
        # "redcapitalwalled2" -> colour plus the rest
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

    # "Building Program" and "coin1" -> "Building Program", "Coin 1"
    $spaced = ($name -creplace '([a-z])([A-Z0-9])', '$1 $2')
    return (Get-Culture).TextInfo.ToTitleCase($spaced.ToLower()) -replace '\s+', ' '
}

$assets = @()

foreach ($folder in $categories.Keys) {
    $category = $categories[$folder]
    $from = Join-Path $Source $folder
    if (-not (Test-Path $from)) { throw "Could not find $from" }

    $to = Join-Path $WebPublic $folder
    New-Item -ItemType Directory -Path $to -Force | Out-Null

    # -Include needs a wildcard in the path, so filter on Extension instead.
    # Skip the "_100_100" resized duplicates (e.g. startplayer_100_100.png is a
    # redundant copy of startplayer.png at a different size) and anything in the
    # exclude list.
    $files = Get-ChildItem $from -File |
        Where-Object {
            $_.Extension -in '.png', '.jpg' -and
            $_.BaseName -notlike '*_100_100' -and
            "$folder/$($_.BaseName)" -notin $exclude
        }
    foreach ($file in $files) {
        Copy-Item $file.FullName (Join-Path $to $file.Name) -Force

        $image = [System.Drawing.Image]::FromFile($file.FullName)
        try {
            $thisCategory = $category
            $width = $image.Width
            $height = $image.Height

            if ($category -eq 'tile') {
                if ($civTiles -contains $file.BaseName) { $thisCategory = 'civtile' }
                # Every map tile covers exactly 4 x 4 squares whatever its source size
                $width = $TILE_PIXELS
                $height = $TILE_PIXELS
            }

            if ($category -eq 'leader') {
                # Scaled to a culture track cell, keeping the aspect of the source
                $height = [int] [Math]::Round($image.Height * $LEADER_WIDTH / $image.Width)
                $width = $LEADER_WIDTH
            }

            if ($category -eq 'wonder') {
                # Keep wonders within one grid square so they tidy without overlap
                $maxDim = [Math]::Max($image.Width, $image.Height)
                if ($maxDim -gt $WONDER_MAX) {
                    $scale = $WONDER_MAX / $maxDim
                    $width = [int] [Math]::Round($image.Width * $scale)
                    $height = [int] [Math]::Round($image.Height * $scale)
                }
            }

            $assets += [ordered] @{
                id       = "$folder/$($file.BaseName)"
                category = $thisCategory
                # The path the client loads from, relative to /board/
                path     = "$folder/$($file.Name)"
                label    = Get-Label $thisCategory $file.BaseName
                width    = $width
                height   = $height
            }
        } finally {
            $image.Dispose()
        }
    }

    Write-Host ("  {0,-10} {1,3} files" -f $folder, (Get-ChildItem $to -File).Count)
}

# The culture track is a backdrop, not a piece, so it is copied on its own and
# only its natural size is recorded. The engine scales it to the map width.
$trackSource = Join-Path $Source 'DoC\PBF Modding Material\culture track.png'
if (-not (Test-Path $trackSource)) { throw "Could not find $trackSource" }
Copy-Item $trackSource (Join-Path $WebPublic 'culture-track.png') -Force

$trackImage = [System.Drawing.Image]::FromFile($trackSource)
try {
    $track = [ordered] @{
        path   = 'culture-track.png'
        width  = $trackImage.Width
        height = $trackImage.Height
    }
} finally {
    $trackImage.Dispose()
}
Write-Host ("  {0,-10} {1,3} x {2}" -f 'track', $track.width, $track.height)

$payload = [ordered] @{
    note         = 'Generated by tools/board-assets.ps1. Do not edit by hand.'
    source       = 'Civilization/Moderator'
    cultureTrack = $track
    assets       = $assets
}

New-Item -ItemType Directory -Path (Split-Path $Manifest) -Force | Out-Null
$json = $payload | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText(
    (New-Item -ItemType File -Path $Manifest -Force).FullName,
    $json + "`n",
    (New-Object System.Text.UTF8Encoding($false)))

Write-Host "`nWrote $($assets.Count) pieces to $Manifest"
