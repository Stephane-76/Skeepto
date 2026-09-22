# =============================================================================
# build-win.ps1 - Build the Skeepto Windows app (.exe installer) and .zip.
#
# Assumes the WASM engine was already (re)compiled:
#   browser module -> public/SkReactSpreadSheet.{mjs,wasm,wasm.map}
#   Node module    -> Node/Server/SkExcelLib.{cjs,wasm}
# react-scripts build copies public/ into build/, so the browser .wasm is
# picked up automatically. electron-builder also packs the Node module.
#
# Usage (from the project root):
#   .\build-win.cmd              # recommended: bypasses Restricted execution policy
#   powershell -ExecutionPolicy Bypass -File .\build-win.ps1
#   .\build-win.cmd -Open       # then launch the generated installer
# =============================================================================

param(
    [switch]$Open
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Show-Wasm($path) {
    if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path
        Write-Host ("    {0:N1} MB  {1}  {2}" -f ($item.Length / 1MB), $item.LastWriteTime, $path)
    } else {
        Write-Warning "    $path not found - did the WASM compile succeed?"
    }
}

Write-Host "==> Checking WASM artifacts"
Show-Wasm "public/SkReactSpreadSheet.wasm"
Show-Wasm "Node/Server/SkExcelLib.wasm"

Write-Host "==> Building the React app + packaging the Windows app"
npm run dist:win
if ($LASTEXITCODE -ne 0) {
    throw "npm run dist:win failed with exit code $LASTEXITCODE"
}

Write-Host "==> Done. Artifacts in dist-electron/:"
Get-ChildItem -Path "dist-electron" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.exe', '.zip') } |
    ForEach-Object { Write-Host ("    {0}" -f $_.FullName) }

$installer = Get-ChildItem -Path "dist-electron" -Filter '*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($installer -and $Open) {
    Start-Process -FilePath $installer.FullName
}
