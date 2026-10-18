# Oyna.exe başlatıcısını derler. Windows'la gelen .NET Framework derleyicisi (csc) yeterli; ek kurulum yok.
# Kullanım (proje klasöründe): npm run launcher
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..')).Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '.NET Framework 4 derleyicisi (csc.exe) bulunamadı.' }

$src = Join-Path $here 'Launcher.cs'
$ico = Join-Path $here 'yilan.ico'
$out = Join-Path $root 'Oyna.exe'
$opts = @(
  '/nologo', '/target:winexe', '/optimize+', '/codepage:65001', '/platform:anycpu',
  '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Management.dll', '/r:System.Windows.Forms.dll'
)

# Simge, başlatıcının kendi çizim kodundan üretilir (önce simgesiz derle, simgeyi yazdır)
$tmp = Join-Path $env:TEMP 'yilan-launcher-icon.exe'
& $csc @opts "/out:$tmp" $src
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Start-Process -FilePath $tmp -ArgumentList '--write-icon', "`"$ico`"" -Wait -NoNewWindow
Remove-Item $tmp -ErrorAction SilentlyContinue

& $csc @opts "/win32icon:$ico" "/out:$out" $src
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Derlendi: $out"
