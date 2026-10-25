param([Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$Name,[int]$Rows=2,[double]$AnchorX=0.55,[switch]$IncludeDetachedParts)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
public class WalkPart { public int Id,Count,X,Y,W,H;public double CenterX,CenterY; }
public class WalkPacker {
 public static float Pack(string sourcePath,string outputPath,int rows,float anchorX,bool includeDetachedParts) {
  using(var original=new Bitmap(sourcePath))
  using(var source=new Bitmap(original.Width,original.Height,PixelFormat.Format32bppArgb)) {
   using(var g=Graphics.FromImage(source)){g.CompositingMode=CompositingMode.SourceCopy;g.DrawImageUnscaled(original,0,0);}
   int w=source.Width,h=source.Height,count=rows*2,cw=w/2;
   var data=source.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
   int stride=data.Stride;var pixels=new byte[stride*h];Marshal.Copy(data.Scan0,pixels,0,pixels.Length);source.UnlockBits(data);
   var ids=new int[w*h];var queue=new int[w*h];var parts=new List<WalkPart>();int id=0;
   for(int start=0;start<ids.Length;start++){
    if(ids[start]!=0 || pixels[(start/w)*stride+(start%w)*4+3]<=8)continue;
    id++;int read=0,write=1;queue[0]=start;ids[start]=id;int minX=w,minY=h,maxX=0,maxY=0;long sumX=0,sumY=0;
    while(read<write){
     int at=queue[read++],x=at%w,y=at/w;minX=Math.Min(minX,x);maxX=Math.Max(maxX,x);minY=Math.Min(minY,y);maxY=Math.Max(maxY,y);sumX+=x;sumY+=y;
     for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
      int nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;int next=ny*w+nx;
      if(ids[next]==0 && pixels[ny*stride+nx*4+3]>8){ids[next]=id;queue[write++]=next;}
     }
    }
    if(write>500)parts.Add(new WalkPart{Id=id,Count=write,X=minX,Y=minY,W=maxX-minX+1,H=maxY-minY+1,CenterX=(double)sumX/write,CenterY=(double)sumY/write});
   }
   parts.Sort((a,b)=>b.Count.CompareTo(a.Count));
   if(parts.Count<count)throw new Exception("Expected "+count+" complete figures; found "+parts.Count);
   parts=parts.GetRange(0,count);parts.Sort((a,b)=>a.CenterY.CompareTo(b.CenterY));
   for(int row=0;row<rows;row++)if(parts[row*2].CenterX>parts[row*2+1].CenterX){var swap=parts[row*2];parts[row*2]=parts[row*2+1];parts[row*2+1]=swap;}
   // Layered mounts can have a detached cape above the saddle. Preserve those
   // pixels in their original cell rather than dropping the smaller component.
   if(includeDetachedParts){
    int ch=h/rows;
    for(int i=0;i<count;i++){
     var p=parts[i];int minX=w,minY=h,maxX=0,maxY=0;
     for(int y=(i/2)*ch;y<(i/2+1)*ch;y++)for(int x=(i%2)*cw;x<(i%2+1)*cw;x++){
      if(pixels[y*stride+x*4+3]<=8)continue;
      ids[y*w+x]=p.Id;minX=Math.Min(minX,x);maxX=Math.Max(maxX,x);minY=Math.Min(minY,y);maxY=Math.Max(maxY,y);
     }
     p.X=minX;p.Y=minY;p.W=maxX-minX+1;p.H=maxY-minY+1;
    }
   }
   int maxHeight=0;float maxReach=1;
   for(int i=0;i<count;i++){
    var p=parts[i];float anchor=(i%2)*cw+cw*anchorX;maxHeight=Math.Max(maxHeight,p.H);
    maxReach=Math.Max(maxReach,Math.Max(Math.Abs(p.X-anchor),Math.Abs(p.X+p.W-anchor)));
   }
   float scale=Math.Min(224f/maxHeight,120f/maxReach);
   using(var output=new Bitmap(512,256*rows,PixelFormat.Format32bppArgb))
   using(var g=Graphics.FromImage(output)){
    g.Clear(Color.Transparent);g.CompositingMode=CompositingMode.SourceCopy;g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
    for(int i=0;i<count;i++){
     var p=parts[i];
     using(var cut=new Bitmap(p.W,p.H,PixelFormat.Format32bppArgb)){
      var cutData=cut.LockBits(new Rectangle(0,0,p.W,p.H),ImageLockMode.WriteOnly,PixelFormat.Format32bppArgb);var buffer=new byte[cutData.Stride*p.H];
      for(int y=0;y<p.H;y++)for(int x=0;x<p.W;x++){
       int sx=p.X+x,sy=p.Y+y;bool keep=ids[sy*w+sx]==p.Id;
       if(!keep && pixels[sy*stride+sx*4+3]>0)for(int dy=-1;dy<=1&&!keep;dy++)for(int dx=-1;dx<=1&&!keep;dx++){int nx=sx+dx,ny=sy+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h&&ids[ny*w+nx]==p.Id)keep=true;}
       if(keep)Buffer.BlockCopy(pixels,sy*stride+sx*4,buffer,y*cutData.Stride+x*4,4);
      }
      Marshal.Copy(buffer,0,cutData.Scan0,buffer.Length);cut.UnlockBits(cutData);
      float xOut=(i%2)*256+128+(p.X-(i%2)*cw-cw*anchorX)*scale;
      float yOut=(i/2)*256+244-p.H*scale;
      g.DrawImage(cut,new RectangleF(xOut,yOut,p.W*scale,p.H*scale));
     }
    }
    output.Save(outputPath,ImageFormat.Png);
   }
   return maxHeight*scale;
  }
 }
}
'@
$targetDirectory=Join-Path $PSScriptRoot '../public/assets/walk'
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
$contentHeight=[WalkPacker]::Pack((Resolve-Path -LiteralPath $SourcePath).Path,(Join-Path $targetDirectory "$Name.png"),$Rows,$AnchorX,$IncludeDetachedParts.IsPresent)
$meta=@{frameSize=256;frameCount=2*$Rows;ground=244;contentHeight=$contentHeight;anchorX=0.5}
[IO.File]::WriteAllText((Join-Path $targetDirectory "$Name.json"),($meta | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$meta | ConvertTo-Json -Compress
