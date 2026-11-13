Add-Type -AssemblyName System.Drawing

if ($PSScriptRoot) {
    $root = Split-Path -Parent $PSScriptRoot
} else {
    $root = (Get-Location).Path
}
$sourceIconPath = Join-Path $root "assets\icon-512.png"
if (-not (Test-Path $sourceIconPath)) {
    Write-Error "Source icon not found at $sourceIconPath"
    exit 1
}

$sourceImg = [System.Drawing.Bitmap]::FromFile($sourceIconPath)
$brandColor = [System.Drawing.ColorTranslator]::FromHtml("#0b3428")

function Resize-Image($src, $w, $h) {
    $dest = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    return $dest
}

function Create-AdaptiveForeground($src, $size) {
    $dest = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $innerSize = [int]($size * 0.65)
    $offset = [int](($size - $innerSize) / 2)
    $g.DrawImage($src, $offset, $offset, $innerSize, $innerSize)
    $g.Dispose()
    return $dest
}

function Create-SplashScreen($src, $w, $h, $bg) {
    $dest = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear($bg)
    $minDim = [Math]::Min($w, $h)
    # Tasteful logo sizing: ~24% of the smaller dimension, minimum 72px, maximum 420px
    $logoSize = [int]([Math]::Max(72, [Math]::Min(420, $minDim * 0.24)))
    $x = [int](($w - $logoSize) / 2)
    $y = [int](($h - $logoSize) / 2)
    $g.DrawImage($src, $x, $y, $logoSize, $logoSize)
    $g.Dispose()
    return $dest
}

# 1. Generate Android Mipmap Icons
$mipmaps = @(
    @{ dir = "mipmap-mdpi"; icon = 48; fg = 108 },
    @{ dir = "mipmap-hdpi"; icon = 72; fg = 162 },
    @{ dir = "mipmap-xhdpi"; icon = 96; fg = 216 },
    @{ dir = "mipmap-xxhdpi"; icon = 144; fg = 324 },
    @{ dir = "mipmap-xxxhdpi"; icon = 192; fg = 432 }
)

$androidRes = Join-Path $root "android\app\src\main\res"

foreach ($m in $mipmaps) {
    $dirPath = Join-Path $androidRes $m.dir
    if (Test-Path $dirPath) {
        $iconImg = Resize-Image $sourceImg $m.icon $m.icon
        $iconImg.Save((Join-Path $dirPath "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $iconImg.Save((Join-Path $dirPath "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $iconImg.Dispose()

        $fgImg = Create-AdaptiveForeground $sourceImg $m.fg
        $fgImg.Save((Join-Path $dirPath "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $fgImg.Dispose()
        Write-Host "Generated $($m.dir) icons."
    }
}

# Remove default vector foreground in drawable-v24 if present
$oldVector = Join-Path $androidRes "drawable-v24\ic_launcher_foreground.xml"
if (Test-Path $oldVector) {
    Remove-Item -Force $oldVector
    Write-Host "Removed legacy vector $oldVector"
}

# Update background color in ic_launcher_background.xml
$bgXml = Join-Path $androidRes "values\ic_launcher_background.xml"
if (Test-Path $bgXml) {
    $xmlContent = @"
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0b3428</color>
</resources>
"@
    [System.IO.File]::WriteAllText($bgXml, $xmlContent)
    Write-Host "Updated ic_launcher_background.xml to #0b3428"
}

# 2. Generate Android Splash Screens
$splashes = @(
    @{ path = "drawable\splash.png"; w = 480; h = 320 },
    @{ path = "drawable-land-mdpi\splash.png"; w = 480; h = 320 },
    @{ path = "drawable-land-hdpi\splash.png"; w = 800; h = 480 },
    @{ path = "drawable-land-xhdpi\splash.png"; w = 1280; h = 720 },
    @{ path = "drawable-land-xxhdpi\splash.png"; w = 1600; h = 960 },
    @{ path = "drawable-land-xxxhdpi\splash.png"; w = 1920; h = 1280 },
    @{ path = "drawable-port-mdpi\splash.png"; w = 320; h = 480 },
    @{ path = "drawable-port-hdpi\splash.png"; w = 480; h = 800 },
    @{ path = "drawable-port-xhdpi\splash.png"; w = 720; h = 1280 },
    @{ path = "drawable-port-xxhdpi\splash.png"; w = 960; h = 1600 },
    @{ path = "drawable-port-xxxhdpi\splash.png"; w = 1280; h = 1920 }
)

foreach ($s in $splashes) {
    $fullPath = Join-Path $androidRes $s.path
    $parent = Split-Path -Parent $fullPath
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $splashImg = Create-SplashScreen $sourceImg $s.w $s.h $brandColor
    $splashImg.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $splashImg.Dispose()
    Write-Host "Generated Android splash: $($s.path) ($($s.w)x$($s.h))"
}

# 3. Generate iOS Icons & Splash
$iosAppIcon = Join-Path $root "ios\App\App\Assets.xcassets\AppIcon.appiconset\AppIcon-512@2x.png"
if (Test-Path (Split-Path -Parent $iosAppIcon)) {
    $iosIcon = Resize-Image $sourceImg 1024 1024
    $iosIcon.Save($iosAppIcon, [System.Drawing.Imaging.ImageFormat]::Png)
    $iosIcon.Dispose()
    Write-Host "Generated iOS AppIcon (1024x1024)"
}

$iosSplashDir = Join-Path $root "ios\App\App\Assets.xcassets\Splash.imageset"
if (Test-Path $iosSplashDir) {
    $splashFiles = @("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png")
    $iosSplash = Create-SplashScreen $sourceImg 2732 2732 $brandColor
    foreach ($sf in $splashFiles) {
        $iosSplash.Save((Join-Path $iosSplashDir $sf), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $iosSplash.Dispose()
    Write-Host "Generated iOS Splash screens (2732x2732)"
}

$sourceImg.Dispose()
Write-Host "All mobile icons and splash screens successfully generated!"
