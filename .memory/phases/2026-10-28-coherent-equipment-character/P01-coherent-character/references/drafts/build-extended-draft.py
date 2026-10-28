from pathlib import Path
from PIL import Image,ImageDraw,ImageChops
import json
import numpy as np
r=Path('.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references'); d=r/'drafts'; out=d/'candidate-frames'; out.mkdir(exist_ok=True)
order=json.loads((r/'sample-layer-order.json').read_text()); slots=['helmet','armor','gloves','boots','spear','horse']; parts=['back','front']
# All coordinates are in the original 1254px common canvas.
profiles={
 'contact1':{'helmet':[(645,200),(1060,200),(1060,380),(815,410),(760,420),(640,385)],'armor':[(630,370),(860,330),(895,410),(900,495),(960,520),(1010,550),(1010,600),(935,645),(870,655),(860,710),(855,785),(832,828),(725,833),(710,810),(710,755),(700,700),(714,660),(736,615),(740,590),(705,560),(680,520),(650,490),(625,450),(585,450),(580,405)],'gloves':[[(575,380),(645,375),(665,400),(665,449),(625,466),(583,447)]],'boots':[[(720,780),(830,770),(860,800),(845,842),(735,850),(710,830)]],'spear':[(0,390),(108,380),(125,398),(570,386),(590,380),(605,390),(605,432),(570,442),(125,420),(105,438),(0,425)]},
 'contact2':{'helmet':[(630,220),(1050,220),(1050,415),(815,450),(755,450),(650,430)],'armor':[(605,402),(755,370),(845,360),(900,390),(930,440),(930,490),(895,510),(930,530),(1020,515),(1025,575),(950,615),(900,650),(900,720),(880,795),(855,845),(765,850),(745,820),(740,780),(730,740),(720,700),(730,670),(760,630),(760,605),(720,590),(700,565),(680,520),(650,490),(615,475),(590,450)],'gloves':[[(570,405),(615,395),(640,410),(642,447),(618,468),(582,465)],[(745,515),(800,510),(827,530),(825,568),(790,582),(755,570)]],'boots':[[(758,785),(848,778),(880,800),(865,850),(785,862),(753,840)]],'spear':[(0,410),(90,398),(110,415),(500,400),(560,390),(585,400),(590,445),(560,460),(500,455),(110,445),(90,462),(0,447)]},
 'hit1':{'helmet':[(850,250),(1245,250),(1245,500),(1010,500),(950,450),(850,425)],'armor':[(670,430),(760,410),(805,395),(915,410),(970,435),(978,490),(960,530),(930,570),(875,600),(890,625),(930,650),(915,710),(855,725),(800,710),(770,700),(745,735),(740,790),(735,850),(710,895),(650,905),(620,885),(625,850),(640,810),(640,760),(630,735),(630,700),(650,670),(680,630),(700,610),(700,595),(675,580),(660,555),(650,525),(665,500),(680,475)],'gloves':[[(635,420),(695,415),(725,435),(723,480),(690,495),(655,490)],[(655,520),(710,510),(745,530),(745,565),(715,590),(675,580)]],'boots':[[(620,850),(715,840),(750,868),(735,905),(650,918),(610,900)]],'spear':[(0,380),(115,370),(130,388),(500,390),(610,390),(650,400),(660,430),(645,470),(600,475),(500,452),(130,415),(115,430),(0,410)]},
 'hit2':{'helmet':[(855,240),(1245,240),(1245,460),(1015,475),(955,445),(855,425)],'armor':[(700,410),(805,390),(875,380),(950,400),(985,440),(980,505),(940,560),(890,590),(900,615),(940,640),(920,690),(870,720),(820,700),(785,685),(770,710),(755,760),(755,820),(735,875),(670,900),(640,880),(650,840),(655,800),(650,760),(640,735),(640,700),(660,665),(690,630),(710,610),(700,590),(680,580),(670,560),(670,525),(685,495),(700,480)],'gloves':[[(685,385),(735,380),(765,400),(765,445),(730,460),(700,450)],[(685,500),(745,495),(775,515),(775,555),(740,575),(700,570)]],'boots':[[(640,850),(740,840),(775,865),(755,900),(675,910),(630,895)]],'spear':[(0,340),(125,335),(145,350),(510,365),(665,365),(710,380),(715,410),(700,450),(660,455),(500,430),(140,385),(125,400),(0,375)]},
 'defeat1':{'helmet':[(530,255),(795,255),(795,455),(665,510),(540,500),(520,420)],'armor':[(620,390),(735,375),(790,410),(810,475),(810,520),(860,530),(930,565),(945,605),(900,635),(865,655),(850,710),(850,760),(845,835),(820,875),(740,885),(715,855),(710,810),(700,760),(690,720),(690,680),(710,645),(700,615),(660,610),(640,590),(620,570),(590,570),(580,540),(600,520)],'gloves':[[(570,520),(625,510),(655,530),(650,570),(625,590),(585,580)],[(630,610),(685,600),(710,620),(710,660),(680,690),(645,680)]],'boots':[[(730,820),(820,810),(860,840),(845,885),(770,900),(725,880)]],'spear':[(0,700),(100,675),(120,685),(420,585),(545,520),(580,530),(590,560),(575,590),(445,620),(120,725),(100,745),(0,735)]},
 'defeat2':{'helmet':[(620,395),(890,400),(900,575),(780,650),(640,645),(610,570)],'armor':[(610,575),(820,550),(880,590),(900,660),(915,735),(930,790),(970,855),(960,910),(920,930),(850,920),(800,900),(750,885),(710,900),(680,935),(600,950),(540,930),(530,900),(550,860),(570,825),(575,790),(570,760),(590,725),(610,690),(595,665)],'gloves':[[(660,745),(715,735),(745,755),(745,790),(720,815),(675,810)],[(870,825),(925,820),(955,840),(960,880),(930,900),(890,890)]],'boots':[[(530,885),(650,880),(680,910),(665,945),(550,955),(515,935)],[(850,880),(940,875),(970,905),(955,950),(890,965),(850,950)]],'spear':[(145,890),(255,875),(280,895),(740,920),(800,915),(970,965),(975,1010),(800,1015),(740,995),(270,930),(245,945),(145,920)]},
}
def layer(src,paths,subtract=()):
 m=Image.new('L',src.size,0); draw=ImageDraw.Draw(m)
 for poly in paths: draw.polygon(poly,fill=255)
 for poly in subtract: draw.polygon(poly,fill=0)
 result=src.copy(); result.putalpha(ImageChops.multiply(src.getchannel('A'),m)); return result.resize((256,256),Image.Resampling.LANCZOS)
def put(name,images):
 folder=out/name; folder.mkdir(exist_ok=True)
 result=Image.new('RGBA',(256,256),(0,0,0,0))
 for item in order:
  key=(item['slot'],item['part']); im=images.get(key,Image.new('RGBA',(256,256),(0,0,0,0))); im.save(folder/(key[0]+'-'+key[1]+'.png')); result=Image.alpha_composite(result,im)
 result.save(folder/'composite.png'); return result
base={(s,p):Image.open(r/f'sample-{s}-{p}.png').convert('RGBA') for s in slots for p in parts}
put('walk1',base)
for name in ['walk2','walk3','walk4']:
 images=base.copy(); images[('horse','back')]=Image.open(d/f'horse-{name}.png').convert('RGBA').resize((256,256),Image.Resampling.LANCZOS); put(name,images)
def align_horse(src, horse, c):
 # Fit one global transform using only original pixels outside rider, spear and head plume.
 n=128; a=np.array(src.resize((n,n),Image.Resampling.LANCZOS)); b=np.array(horse.resize((n,n),Image.Resampling.LANCZOS)); exclude=Image.new('L',src.size,0); ed=ImageDraw.Draw(exclude)
 for poly in [c['helmet'],c['armor'],c['spear']]+c['gloves']+c['boots']: ed.polygon(poly,fill=255)
 ex=np.array(exclude.resize((n,n),Image.Resampling.NEAREST)); valid=(a[:,:,3]>128)&(ex==0)
 ys,xs=np.nonzero(valid); rng=np.random.default_rng(38); ix=rng.choice(len(xs),size=min(1600,len(xs)),replace=False); xs=xs[ix]; ys=ys[ix]; target=a[ys,xs,:3].astype(np.int16)
 best=(1e9,1.,0,0)
 for scale in np.arange(.84,1.161,.04):
  for dx in range(-22,23,2):
   bx=np.rint((xs-dx)/scale).astype(int); goodx=(bx>=0)&(bx<n); bx=np.clip(bx,0,n-1)
   for dy in range(-22,23,2):
    by=np.rint((ys-dy)/scale).astype(int); good=goodx&(by>=0)&(by<n); by=np.clip(by,0,n-1); pix=b[by,bx]; dif=np.minimum(np.mean(np.abs(target-pix[:,:3].astype(np.int16)),axis=1),60); dif=np.where(good&(pix[:,3]>64),dif,60); score=float(np.mean(dif))
    if score<best[0]: best=(score,float(scale),dx,dy)
 _,scale,dx,dy=best; print('alignment',c['name'],best)
 # Compute output-to-input transform on the original shared canvas.
 shiftx=dx*src.width/n; shifty=dy*src.height/n
 return horse.transform(src.size,Image.Transform.AFFINE,(1/scale,0,-shiftx/scale,0,1/scale,-shifty/scale),Image.Resampling.BICUBIC)
for name,c in profiles.items():
 c['name']=name
 src=Image.open(d/f'pose-{name}.png').convert('RGBA'); horsefile='horse-defeat2-fixed.png' if name=='defeat2' else f'horse-{name}.png'; horse=align_horse(src,Image.open(d/horsefile).convert('RGBA'),c).resize((256,256),Image.Resampling.LANCZOS)

 images={('horse','back'):horse,('helmet','back'):layer(src,[c['helmet']]),('armor','back'):layer(src,[c['armor']],c['gloves']+c['boots']+[c['helmet'],c['spear']]),('gloves','front'):layer(src,c['gloves']),('boots','front'):layer(src,c['boots']),('spear','back'):layer(src,[c['spear']],c['gloves'])}; put(name,images)

# Town: independent standing knight, sharing the same 256px slot canvas.
town=Image.open(d/'pose-town.png').convert('RGBA')
town_helmet=[[(530,230),(970,230),(970,490),(735,505),(675,490),(550,475),(530,430)]]
town_gloves=[[(370,600),(465,600),(480,630),(475,680),(455,710),(390,710),(370,680)],[(710,725),(800,710),(830,750),(830,810),(805,835),(740,830),(710,800)]]
town_boots=[[(440,1050),(605,1050),(620,1100),(610,1160),(450,1175),(435,1150)],[(690,1060),(810,1050),(835,1100),(825,1175),(705,1190),(685,1160)]]
town_spear=[[(365,0),(470,0),(470,610),(462,720),(455,1170),(395,1170),(385,710),(370,600)]]
town_armor=[[(480,425),(740,425),(810,460),(840,520),(845,590),(830,640),(840,700),(855,750),(870,800),(885,920),(835,950),(800,930),(800,1030),(805,1075),(700,1090),(690,1050),(670,1000),(650,970),(620,960),(610,1020),(605,1090),(490,1090),(475,1040),(500,970),(505,930),(470,930),(450,900),(480,820),(500,750),(490,710),(450,700),(440,650),(460,600),(465,540)]]
town_images={('horse','back'):base[('horse','back')],('helmet','back'):layer(town,town_helmet),('armor','back'):layer(town,town_armor,town_helmet+town_gloves+town_boots+town_spear),('gloves','front'):layer(town,town_gloves),('boots','front'):layer(town,town_boots),('spear','back'):layer(town,town_spear,town_gloves)}
put('town',town_images)

print('candidate frames prepared:', sorted(p.name for p in out.iterdir() if p.is_dir()))
