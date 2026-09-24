<#
Copies the tech card photos into the web package so the tech pyramid and the
level-tabbed picker can show real card art, the way `item-assets.ps1` already
does for every other item kind.

Unlike `item-assets.ps1`, this one renames while copying: the source file
names (`metalworking_lvl1.jpg`) do not match what `itemImage()` asks for
(`Metalworking.jpg`), and the mapping does not follow a mechanical rule —
some names drop the underscore (`Metalworking`), some are a genuine mismatch
between the spreadsheet and the physical card (`Replacement Parts` on the
sheet, `Replaceable Parts` on the card, the same situation `item-assets.ps1`
already handles for `ReplaceableParts.png`/`ReplacementParts.png`). So the map
is an explicit table, not a derived transformation.

The source photos are gitignored, cropped and prepared separately; see
`Civilization/Moderator/techs/`.
#>
param(
    [string] $Source = (Join-Path $PSScriptRoot '..\Civilization\Moderator\techs'),
    [string] $WebPublic = (Join-Path $PSScriptRoot '..\packages\web\public\items')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Source)) { throw "Could not find $Source" }

New-Item -ItemType Directory -Path $WebPublic -Force | Out-Null

# Destination filename (what itemImage() asks for) = source filename (what the
# prepared card photos are actually called).
$techFiles = [ordered] @{
    'AnimalHusbandry.jpg' = 'animal_husbandry_lvl1.jpg'
    'Agriculture.jpg'     = 'agriculture_lvl1.jpg'
    'CodeofLaws.jpg'      = 'code_of_laws_lvl1.jpg'
    'Currency.jpg'        = 'currency_lvl1.jpg'
    'HorsebackRiding.jpg' = 'horseback_riding_lvl1.jpg'
    'Masonry.jpg'         = 'masonry_lvl1.jpg'
    'Metalworking.jpg'    = 'metalworking_lvl1.jpg'
    'Navigation.jpg'      = 'navigation_lvl1.jpg'
    'Philosophy.jpg'      = 'philosophy_lvl1.jpg'
    'Pottery.jpg'         = 'pottery_lvl1.jpg'
    'Writing.jpg'         = 'writing_lvl1.jpg'
    'Navy.jpg'            = 'navy_lvl1.jpg'

    'CivilService.jpg'    = 'civil_service_lvl2.jpg'
    'Chivalry.jpg'        = 'chivalry_lvl2.jpg'
    'Construction.jpg'    = 'construction_lvl2.jpg'
    'Democracy.jpg'       = 'democracy_lvl2.jpg'
    'Engineering.jpg'     = 'engineering_lvl2.jpg'
    'Irrigation.jpg'      = 'irrigation_lvl2.jpg'
    'Mathematics.jpg'     = 'mathematics_lvl2.jpg'
    'Monarchy.jpg'        = 'monarchy_lvl2.jpg'
    'Mysticism.jpg'       = 'mysticism_lvl2.jpg'
    'PrintingPress.jpg'   = 'printing_press_lvl2.jpg'
    'Sailing.jpg'         = 'sailing_lvl2.jpg'
    'Logistics.jpg'       = 'logistics_lvl2.jpg'
    'Bureaucracy.jpg'     = 'bureaucracy_lvl2.jpg'

    'Banking.jpg'         = 'banking_lvl3.jpg'
    'Biology.jpg'         = 'biology_lvl3.jpg'
    'Communism.jpg'       = 'communism_lvl3.jpg'
    'Ecology.jpg'         = 'ecology_lvl3.jpg'
    'Gunpowder.jpg'       = 'gunpowder_lvl3.jpg'
    'MetalCasting.jpg'    = 'metal_casting_lvl3.jpg'
    'MilitaryScience.jpg' = 'military_science_lvl3.jpg'
    'Railroad.jpg'        = 'railroad_lvl3.jpg'
    'SteamPower.jpg'      = 'steam_power_lvl3.jpg'
    'Theology.jpg'        = 'theology_lvl3.jpg'
    'Education.jpg'       = 'education_lvl3.jpg'

    'AtomicTheory.jpg'    = 'atomic_theory_lvl4.jpg'
    'Ballistics.jpg'      = 'ballistics_lvl4.jpg'
    'Combustion.jpg'      = 'combustion_lvl4.jpg'
    'Computers.jpg'       = 'computers_lvl4.jpg'
    'Flight.jpg'          = 'flight_lvl4.jpg'
    'MassMedia.jpg'       = 'mass_media_lvl4.jpg'
    'Plastics.jpg'        = 'plastics_lvl4.jpg'
    # Sheet says "Replacement Parts", card says "Replaceable" — same mismatch
    # item-assets.ps1 already documents for the other level-4 tech alias.
    'ReplacementParts.jpg' = 'replaceable_parts_lvl4.jpg'

    'SpaceFlight.jpg'     = 'spaceflight_lvl5.jpg'
}

# The source folder and the map must agree exactly, in both directions: a
# stray file on disk, or a map entry with no file, is a sign something in the
# provenance has drifted since this script was written.
$sourceFiles = Get-ChildItem $Source -File | Where-Object { $_.Extension -in '.jpg', '.png' }
$sourceNames = [System.Collections.Generic.HashSet[string]]::new([string[]] ($sourceFiles | ForEach-Object { $_.Name }), [System.StringComparer]::OrdinalIgnoreCase)
$mappedNames = [System.Collections.Generic.HashSet[string]]::new([string[]] $techFiles.Values, [System.StringComparer]::OrdinalIgnoreCase)

foreach ($name in $sourceNames) {
    if (-not $mappedNames.Contains($name)) { throw "No destination mapped for source file $name" }
}
foreach ($name in $mappedNames) {
    if (-not $sourceNames.Contains($name)) { throw "Mapped source file $name is missing from $Source" }
}

foreach ($destination in $techFiles.Keys) {
    $sourcePath = Join-Path $Source $techFiles[$destination]
    Copy-Item $sourcePath (Join-Path $WebPublic $destination) -Force
}

Write-Host ("Wrote {0} tech card images to {1}" -f $techFiles.Count, $WebPublic)
