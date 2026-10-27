from PIL import Image,ImageDraw,ImageChops
from pathlib import Path
import json
r=Path('.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references')
d=r/'drafts'; original=Image.open(d/'mounted-master-draft.png').convert('RGBA'); horse=Image.open(d/'horse-draft.png').convert('RGBA'); size=original.size
order=[('horse','back'),('spear','back'),('armor','back'),('boots','back'),('gloves','back'),('helmet','back'),('horse','front'),('armor','front'),('boots','front'),('spear','front'),('gloves','front'),('helmet','front')]
(r/'sample-layer-order.json').write_text(json.dumps([{'slot':s,'part':p} for s,p in order],indent=2),encoding='utf-8')
polygons={
 ('helmet','back'):[[(650,185),(1008,175),(1008,375),(845,393),(810,375),(785,370),(765,383),(692,392),(660,360),(650,330)]],
 ('armor','back'):[[(698,365),(755,347),(780,330),(828,331),(871,356),(889,395),(879,432),(861,447),(875,458),(881,482),(865,508),(832,521),(810,520),(811,535),(850,546),(907,572),(942,576),(937,590),(900,601),(880,615),(861,642),(834,650),(800,629),(782,620),(764,624),(756,650),(755,680),(742,712),(736,755),(755,784),(747,806),(701,805),(692,781),(686,745),(672,716),(669,700),(670,678),(685,650),(695,623),(684,607),(673,588),(677,565),(691,545),(703,530),(692,520),(682,518),(666,507),(651,497),(656,477),(670,471),(701,470),(704,451),(697,441),(680,442),(667,457),(646,454),(632,445),(625,433),(633,415),(651,405),(680,405),(696,400)]],
 ('spear','back'):[[(14,397),(106,373),(123,384),(340,384),(470,380),(579,365),(598,362),(610,369),(616,381),(616,407),(609,420),(598,425),(579,421),(470,407),(340,405),(124,405),(107,420)]],
 ('gloves','front'):[[(604,385),(633,378),(654,387),(669,404),(672,424),(663,444),(642,455),(619,452),(602,438),(596,416)],[(653,471),(678,461),(706,469),(722,481),(719,505),(704,522),(683,524),(658,516),(648,501)]],
 ('boots','front'):[[(681,779),(702,772),(737,770),(769,779),(790,802),(793,822),(771,835),(704,834),(683,825),(670,815)]],
}
polygons[('armor','back')].append([(700,555),(758,554),(792,571),(804,605),(790,630),(773,650),(763,671),(778,699),(783,739),(799,777),(792,805),(765,816),(700,809),(692,785),(688,753),(682,727),(670,708),(656,694),(658,670),(670,646),(682,630),(685,609),(679,594),(681,575)])
def extract(img,paths,subtract=()):
 mask=Image.new('L',size,0); dr=ImageDraw.Draw(mask)
 for pts in paths: dr.polygon(pts,fill=255)
 for pts in subtract: dr.polygon(pts,fill=0)
 out=img.copy(); out.putalpha(ImageChops.multiply(img.getchannel('A'),mask)); return out
parts={k:extract(original,v,polygons[('gloves','front')]+polygons[('boots','front')] if k==('armor','back') else ()) for k,v in polygons.items()}; parts[('horse','back')]=horse
blank=Image.new('RGBA',size,(0,0,0,0)); composite=blank.copy()
for slot,part in order:
 image=parts.get((slot,part),blank)
 image.resize((256,256),Image.Resampling.LANCZOS).save(r/f'sample-{slot}-{part}.png')
 composite=Image.alpha_composite(composite,image)
original.resize((256,256),Image.Resampling.LANCZOS).save(r/'sample-master.png')
composite_small=Image.new('RGBA',(256,256),(0,0,0,0))
for slot,part in order: composite_small=Image.alpha_composite(composite_small,Image.open(r/f'sample-{slot}-{part}.png').convert('RGBA'))
composite_small.save(r/'sample-composite.png')
composite.save(d/'composite-large.png')
print('created',len(order),'layers')
