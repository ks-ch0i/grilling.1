param(
  [string] $RepositoryRoot = (Split-Path $PSScriptRoot -Parent),
  [string] $OutputDirectory = (Join-Path $RepositoryRoot 'public/assets/gear-aligned'),
  [string[]] $Rarities = @('common','uncommon','rare','unique','legendary')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# Crops refer to intact items inside the original 256px cells, not their transparent margins.
$crops = @{
  helmet = @{
    common=@(0,114,73,103,114); uncommon=@(0,116,90,101,102); rare=@(0,96,74,115,113); unique=@(4,115,64,108,116); legendary=@(0,106,72,123,113)
  }
  armor = @{
    common=@(0,73,70,131,122); uncommon=@(0,95,67,93,120); rare=@(0,83,73,125,114); unique=@(0,73,68,150,121); legendary=@(0,80,69,141,123)
  }
  boots = @{
    common=@(@(10,84,64,48,119),@(10,138,64,74,116));
    uncommon=@(@(10,93,64,47,123),@(10,147,64,81,113));
    rare=@(@(10,42,64,89,110),@(10,138,64,86,110));
    unique=@(@(10,66,64,82,92),@(10,170,64,71,96));
    legendary=@(@(10,69,64,76,113),@(10,151,64,75,113))
  }
  spear = @{
    common=@(0,12,113,236,16); uncommon=@(0,8,110,240,27); rare=@(0,7,112,244,24); unique=@(0,10,109,239,19); legendary=@(0,14,121,233,21)
  }
  horse = @{
    common=@(0,58,73,189,113); uncommon=@(0,58,73,189,113); rare=@(0,25,81,220,109); unique=@(0,25,82,221,109); legendary=@(0,25,81,221,109)
  }
  gloves = @{
    common=@(@(0,57,68,72,92),@(0,163,68,71,92));
    uncommon=@(@(0,52,72,69,114),@(0,135,72,70,114));
    rare=@(@(0,121,68,80,90),@(0,121,68,80,90));
    unique=@(@(0,32,73,91,108),@(0,142,73,91,106));
    legendary=@(@(0,59,72,71,111),@(0,143,71,71,112))
  }
}

# Each record is [center x, center y, width, height, clockwise rotation].
$walk=@{helmet=@(133,70,43,46,0);armor=@(144,110,42,48,0);boots=@(@(126,174,18,34,0),@(141,180,20,32,0));gloves=@(@(113,111,12,15,0),@(125,126,12,15,0));spear=@(70,98,132,8,15);horse=@(128,158,163,82,0)}
$actions=@(
  @{helmet=@(116,102,38,41,0);armor=@(136,125,41,43,20);boots=@(@(143,173,17,30,0),@(154,180,19,31,0));gloves=@(@(109,126,12,14,0),@(120,132,12,14,0));spear=@(70,124,128,8,0);horse=@(130,167,163,82,0)},
  @{helmet=@(129,98,39,42,0);armor=@(146,125,42,44,0);boots=@(@(143,173,17,30,0),@(154,180,19,31,0));gloves=@(@(123,129,12,14,0),@(132,137,12,14,0));spear=@(82,110,140,8,20);horse=@(131,164,164,84,0)},
  @{helmet=@(156,78,40,42,0);armor=@(163,111,42,45,0);boots=@(@(141,165,17,30,0),@(151,177,19,31,0));gloves=@(@(135,123,12,14,0),@(143,132,12,14,0));spear=@(88,84,140,8,40);horse=@(131,155,169,85,0)},
  @{helmet=@(120,78,40,42,0);armor=@(136,111,42,45,0);boots=@(@(130,166,17,30,0),@(143,175,19,31,0));gloves=@(@(115,123,12,14,0),@(125,132,12,14,0));spear=@(65,83,140,8,40);horse=@(132,155,169,85,0)},
  @{helmet=@(80,129,38,40,25);armor=@(105,150,42,43,35);boots=@(@(132,183,17,30,20),@(142,188,19,31,20));gloves=@(@(95,158,12,14,20),@(107,165,12,14,20));spear=@(65,145,120,8,15);horse=@(130,202,166,53,0)},
  @{helmet=@(122,156,38,40,25);armor=@(146,179,42,43,35);boots=@(@(127,215,17,30,60),@(143,219,19,31,60));gloves=@(@(130,188,12,14,20),@(142,193,12,14,20));spear=@(80,184,140,8,15);horse=@(130,214,170,44,0)}
)
$town=@{helmet=@(124,34,46,48,0);armor=@(128,90,55,65,0);boots=@(@(110,219,22,50,0),@(159,219,27,50,0));gloves=@(@(86,135,14,18,0),@(169,135,14,18,0));spear=@(179,127,180,8,-90);horse=@(128,151,166,88,0)}

function Draw-Item($graphics,$image,$crop,$target,$frame,[bool]$flip) {
  $sourceFrame=[int]$crop[0]
  $source=[System.Drawing.Rectangle]::new([int]($crop[1]+($sourceFrame%2)*256),[int]($crop[2]+[Math]::Floor($sourceFrame/2)*256),[int]$crop[3],[int]$crop[4])
  $cx=[double]$target[0]+($frame%2)*256
  $cy=[double]$target[1]+[Math]::Floor($frame/2)*256
  $width=[double]$target[2];$height=[double]$target[3];$angle=[double]$target[4]
  $saved=$graphics.Save()
  $graphics.SetClip([System.Drawing.Rectangle]::new(($frame%2)*256,[int]([Math]::Floor($frame/2)*256),256,256))
  $graphics.TranslateTransform([float]$cx,[float]$cy)
  $graphics.RotateTransform([float]$angle)
  if($flip){$graphics.ScaleTransform(-1,1)}
  $dest=[System.Drawing.RectangleF]::new([float](-$width/2),[float](-$height/2),[float]$width,[float]$height)
  $graphics.DrawImage($image,$dest,$source,[System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Restore($saved)
}

foreach($slot in @('helmet','armor','gloves','boots','spear','horse')) {
  foreach($rarity in $Rarities) {
    $sourcePath=Join-Path $RepositoryRoot "public/assets/gear/$slot-$rarity.png"
    $image=[System.Drawing.Image]::FromFile($sourcePath)
    $atlas=[System.Drawing.Bitmap]::new(512,1536,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g=[System.Drawing.Graphics]::FromImage($atlas)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    for($frame=0;$frame -le 10;$frame++) {
      $pose=if($frame -lt 4){$walk}elseif($frame -lt 10){$actions[$frame-4]}else{$town}
      if($slot -in @('gloves','boots')) {
        Draw-Item $g $image $crops[$slot][$rarity][0] $pose[$slot][0] $frame $false
        Draw-Item $g $image $crops[$slot][$rarity][1] $pose[$slot][1] $frame ($slot -eq 'gloves' -and $rarity -eq 'rare')
      } elseif ($slot -eq 'horse' -and $rarity -in @('rare','unique','legendary') -and $frame -in @(6,7)) {
        # The rearing horse raises its head independently of the saddle.
        $crop=$crops[$slot][$rarity]; $target=$pose[$slot]; $headWidth=62
        $headTargetWidth=$target[2]*$headWidth/$crop[3]; $bodyTargetWidth=$target[2]-$headTargetWidth
        $left=$target[0]-$target[2]/2
        Draw-Item $g $image @($crop[0],$crop[1],$crop[2],$headWidth,$crop[4]) @(($left+$headTargetWidth/2+7),($target[1]-23),$headTargetWidth,$target[3],0) $frame $false
        Draw-Item $g $image @($crop[0],($crop[1]+$headWidth),$crop[2],($crop[3]-$headWidth),$crop[4]) @(($left+$headTargetWidth+$bodyTargetWidth/2),$target[1],$bodyTargetWidth,$target[3],0) $frame $false
      } else {
        $flip=($slot -eq 'spear' -and $frame -lt 10)
        Draw-Item $g $image $crops[$slot][$rarity] $pose[$slot] $frame $flip
      }
    }
    $atlas.Save((Join-Path $OutputDirectory "$slot-$rarity.png"),[System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose();$atlas.Dispose();$image.Dispose()
  }
}
