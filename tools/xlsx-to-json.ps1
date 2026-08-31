<#
Konverterer gamedata-faf-waw.xlsx til en rå celle-dump i JSON.

Målet er ikke å tolke spilldata her, men å gjengi PRESIST det Apache POI
ga ItemReader.java, slik at TypeScript-porten kan gjenbruke samme filtre.

Derfor gjengis Apache POIs Cell.toString():
  BLANK    -> ""
  FORMULA  -> formeltekst (derfor "RAND()" i notRandomPredicate)
  NUMERIC  -> Double.toString(verdi), dvs. 12 blir "12.0" og 1.3 blir "1.3"
  STRING   -> strengverdien (rike tekstløp konkateneres)
  BOOLEAN  -> "TRUE"/"FALSE"
  ERROR    -> feilteksten

Utdata: tett 2D-grid per ark. Rad 0 er med (ItemReader filtrerer den selv via
rowNotZeroPredicate), og kolonner komprimeres IKKE her — Java filtrerer hver
kolonne uavhengig, og den oppførselen må porten kunne reprodusere.
#>
param(
    [Parameter(Mandatory = $true)][string] $Xlsx,
    [Parameter(Mandatory = $true)][string] $Out,
    [string] $GameType = 'WAW'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ns = @{ m = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
         r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' }

function Read-ZipEntry([System.IO.Compression.ZipArchive] $zip, [string] $name) {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $name }
    if ($null -eq $entry) { throw "Fant ikke '$name' i arkivet" }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { $reader.ReadToEnd() } finally { $reader.Dispose() }
}

# Java Double.toString: alltid minst ett desimal, kortest form som round-tripper.
function Format-JavaDouble([string] $raw) {
    $value = [double]::Parse($raw, [System.Globalization.CultureInfo]::InvariantCulture)
    $text = $value.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture)
    if ($text -notmatch '[.eE]') { $text += '.0' }
    $text
}

# "BC12" -> 0-basert kolonneindeks
function Get-ColumnIndex([string] $cellRef) {
    $letters = ($cellRef -replace '\d', '')
    $index = 0
    foreach ($ch in $letters.ToCharArray()) {
        $index = $index * 26 + ([int][char]::ToUpper($ch) - 64)
    }
    $index - 1
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Xlsx))
try {
    # --- sharedStrings: konkatener alle <t> i hver <si> (rike tekstløp) ---
    $sharedStrings = @()
    if ($zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }) {
        $sstXml = [xml] (Read-ZipEntry $zip 'xl/sharedStrings.xml')
        foreach ($si in (Select-Xml -Xml $sstXml -XPath '/m:sst/m:si' -Namespace $ns)) {
            $parts = Select-Xml -Xml $si.Node -XPath './/m:t' -Namespace $ns
            $sharedStrings += (($parts | ForEach-Object { $_.Node.InnerText }) -join '')
        }
    }
    Write-Host "sharedStrings: $($sharedStrings.Count)"

    # --- rId -> worksheets/sheetN.xml ---
    $relsXml = [xml] (Read-ZipEntry $zip 'xl/_rels/workbook.xml.rels')
    $relTarget = @{}
    foreach ($rel in $relsXml.Relationships.Relationship) {
        $relTarget[$rel.Id] = 'xl/' + ($rel.Target -replace '^/xl/', '')
    }

    $workbookXml = [xml] (Read-ZipEntry $zip 'xl/workbook.xml')
    $sheets = [ordered] @{}

    foreach ($sheet in (Select-Xml -Xml $workbookXml -XPath '/m:workbook/m:sheets/m:sheet' -Namespace $ns)) {
        $sheetName = $sheet.Node.name
        $rId = $sheet.Node.GetAttribute('id', $ns.r)
        $sheetXml = [xml] (Read-ZipEntry $zip $relTarget[$rId])

        $rows = @()
        foreach ($row in (Select-Xml -Xml $sheetXml -XPath '/m:worksheet/m:sheetData/m:row' -Namespace $ns)) {
            $cells = @{}
            $widest = -1
            foreach ($cell in (Select-Xml -Xml $row.Node -XPath './m:c' -Namespace $ns)) {
                $node = $cell.Node
                $colIndex = Get-ColumnIndex $node.r
                $formula = Select-Xml -Xml $node -XPath './m:f' -Namespace $ns
                $valueNode = Select-Xml -Xml $node -XPath './m:v' -Namespace $ns
                $inline = Select-Xml -Xml $node -XPath './m:is' -Namespace $ns
                $type = $node.t

                $text = if ($formula) {
                    # POI: FORMULA -> getCellFormula()
                    $formula.Node.InnerText
                } elseif ($null -eq $valueNode -and $null -eq $inline) {
                    ''                                        # BLANK
                } elseif ($type -eq 's') {
                    $sharedStrings[[int] $valueNode.Node.InnerText]
                } elseif ($type -eq 'inlineStr') {
                    (($inline | Select-Xml -XPath './/m:t' -Namespace $ns | ForEach-Object { $_.Node.InnerText }) -join '')
                } elseif ($type -eq 'str') {
                    $valueNode.Node.InnerText
                } elseif ($type -eq 'b') {
                    if ($valueNode.Node.InnerText -eq '1') { 'TRUE' } else { 'FALSE' }
                } elseif ($type -eq 'e') {
                    $valueNode.Node.InnerText
                } else {
                    Format-JavaDouble $valueNode.Node.InnerText   # NUMERIC
                }

                $cells[$colIndex] = $text
                if ($colIndex -gt $widest) { $widest = $colIndex }
            }

            $dense = @()
            for ($i = 0; $i -le $widest; $i++) {
                $dense += if ($cells.ContainsKey($i)) { $cells[$i] } else { '' }
            }
            $rows += , $dense
        }

        $sheets[$sheetName] = $rows
        Write-Host ("  {0,-16} {1,3} rader" -f $sheetName, $rows.Count)
    }
} finally {
    $zip.Dispose()
}

$payload = [ordered] @{
    gameType = $GameType
    source   = [System.IO.Path]::GetFileName($Xlsx)
    note     = 'Autogenerert av tools/xlsx-to-json.ps1. Rediger ikke manuelt.'
    sheets   = $sheets
}

$json = $payload | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText((New-Item -ItemType File -Path $Out -Force).FullName, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`nSkrev $Out ($([math]::Round((Get-Item $Out).Length / 1024, 1)) KB)"
