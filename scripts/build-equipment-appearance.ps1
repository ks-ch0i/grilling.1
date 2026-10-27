param(
  [string] $RepositoryRoot = (Split-Path $PSScriptRoot -Parent),
  [string] $SourceDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) '.memory/phases/2026-10-27-equipment-only-character/P01-gear-only-rendering/references'),
  [string] $OutputDirectory = (Join-Path $RepositoryRoot 'public/assets/gear-aligned'),
  [string[]] $Rarities = @('common','uncommon','rare','unique','legendary')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$boundsHelper = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class EquipmentAtlasPixels {
  public static Rectangle FindBounds(Bitmap bitmap, Rectangle region, byte alphaThreshold) {
    var data = bitmap.LockBits(region, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      int stride = Math.Abs(data.Stride);
      int rowLength = region.Width * 4;
      var row = new byte[rowLength];
      int left = region.Width;
      int top = region.Height;
      int right = -1;
      int bottom = -1;
      for (int y = 0; y < region.Height; y++) {
        int sourceY = data.Stride >= 0 ? y : region.Height - 1 - y;
        IntPtr rowPointer = IntPtr.Add(data.Scan0, sourceY * stride);
        Marshal.Copy(rowPointer, row, 0, rowLength);
        for (int x = 0; x < region.Width; x++) {
          if (row[x * 4 + 3] < alphaThreshold) continue;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      if (right < left || bottom < top) return Rectangle.Empty;
      return new Rectangle(region.X + left, region.Y + top, right - left + 1, bottom - top + 1);
    } finally {
      bitmap.UnlockBits(data);
    }
  }
}
'@
$drawingReferences = @([System.Drawing.Bitmap].Assembly.Location, [System.Drawing.Rectangle].Assembly.Location)
Add-Type -TypeDefinition $boundsHelper -ReferencedAssemblies $drawingReferences

$slots = @('helmet','armor','gloves','boots','spear','horse')
$frames = 256
$atlasWidth = $frames * 2
$atlasHeight = $frames * 6

# Targets are center X/Y followed by maximum width/height in a 256px frame.
# Each complete slot silhouette is fitted proportionally, then aligned to the
# same body landmarks across rarities. The final cell remains empty padding.
$walkTargets = @{
  helmet = @(132,72,88,88); armor = @(128,148,160,166); gloves = @(128,126,104,56)
  boots = @(128,208,150,78); spear = @(128,137,246,46); horse = @(128,172,246,152)
}
$actionTargets = @(
  @{ helmet=@(116,102,84,88); armor=@(136,150,160,166); gloves=@(128,126,104,58); boots=@(128,188,150,78); spear=@(128,142,246,50); horse=@(130,167,246,152) },
  @{ helmet=@(129,98,84,88); armor=@(146,150,160,166); gloves=@(128,132,104,58); boots=@(128,188,150,78); spear=@(128,140,246,50); horse=@(131,164,246,152) },
  @{ helmet=@(156,78,84,88); armor=@(163,136,160,166); gloves=@(128,128,104,58); boots=@(128,182,150,78); spear=@(128,138,246,52); horse=@(131,155,246,152) },
  @{ helmet=@(120,78,84,88); armor=@(136,136,160,166); gloves=@(128,128,104,58); boots=@(128,182,150,78); spear=@(128,138,246,52); horse=@(132,155,246,152) },
  @{ helmet=@(80,129,84,88); armor=@(105,171,160,166); gloves=@(128,164,104,58); boots=@(128,205,150,78); spear=@(128,166,246,52); horse=@(130,196,246,120) },
  @{ helmet=@(122,156,84,88); armor=@(146,198,160,150); gloves=@(128,190,104,58); boots=@(128,220,150,66); spear=@(128,194,246,52); horse=@(130,204,246,96) }
)
$townTargets = @{
  helmet = @(128,62,88,88); armor = @(128,140,160,166); gloves = @(128,142,104,58)
  boots = @(128,211,150,78); spear = @(183,128,44,184); horse = @(128,132,246,160)
}

function Get-Target($slot, $frame) {
  if ($frame -lt 4) { return $walkTargets[$slot] }
  if ($frame -lt 10) { return $actionTargets[$frame - 4][$slot] }
  return $townTargets[$slot]
}

if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
  throw "Equipment source directory does not exist: $SourceDirectory"
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

foreach ($slot in $slots) {
  foreach ($rarity in $Rarities) {
    $sourcePath = Join-Path $SourceDirectory "$slot-$rarity-4x3.png"
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Missing complete equipment source atlas: $sourcePath"
    }

    $source = [System.Drawing.Bitmap]::new($sourcePath)
    $atlas = [System.Drawing.Bitmap]::new($atlasWidth, $atlasHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($atlas)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      for ($frame = 0; $frame -le 10; $frame++) {
        $column = $frame % 4
        $row = [int][Math]::Floor($frame / 4)
        $left = [int][Math]::Floor($column * $source.Width / 4)
        $right = [int][Math]::Floor(($column + 1) * $source.Width / 4)
        $top = [int][Math]::Floor($row * $source.Height / 3)
        $bottom = [int][Math]::Floor(($row + 1) * $source.Height / 3)
        $cell = [System.Drawing.Rectangle]::new($left, $top, $right - $left, $bottom - $top)
        $content = [EquipmentAtlasPixels]::FindBounds($source, $cell, 32)
        if ($content.IsEmpty) { throw "$sourcePath frame $frame has no visible art" }

        $target = Get-Target $slot $frame
        $scale = [Math]::Min([double]$target[2] / $content.Width, [double]$target[3] / $content.Height)
        $width = [Math]::Max(1, [int][Math]::Round($content.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($content.Height * $scale))
        $destination = [System.Drawing.Rectangle]::new(
          [int][Math]::Round($target[0] - $width / 2),
          [int][Math]::Round($target[1] - $height / 2),
          $width,
          $height
        )
        if ($destination.Left -lt 0 -or $destination.Top -lt 0 -or $destination.Right -gt $frames -or $destination.Bottom -gt $frames) {
          throw "$sourcePath frame $frame does not fit in a 256px cell: $destination"
        }

        $cellLeft = ($frame % 2) * $frames
        $cellTop = [int][Math]::Floor($frame / 2) * $frames
        $graphics.SetClip([System.Drawing.Rectangle]::new($cellLeft, $cellTop, $frames, $frames))
        $targetRect = [System.Drawing.Rectangle]::new($cellLeft + $destination.X, $cellTop + $destination.Y, $destination.Width, $destination.Height)
        $graphics.DrawImage($source, $targetRect, $content, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.ResetClip()
      }

      $outputPath = Join-Path $OutputDirectory "$slot-$rarity.png"
      $atlas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $atlas.Dispose()
      $source.Dispose()
    }
  }
}
