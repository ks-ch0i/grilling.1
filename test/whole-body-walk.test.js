import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import { advanceWalkPhase, WALK_CHARACTERS, WholeBodyWalk } from '../src/game/ui/WholeBodyWalk.js';

function rgbaPng(bytes){
  assert.equal(bytes[24],8);assert.equal(bytes[25],6);
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),chunks=[];
  for(let offset=8;offset<bytes.length;){
    const size=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
    if(kind==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+size));
    offset+=size+12;
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*4,rgba=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)];assert.ok(filter<=4);
    for(let x=0;x<stride;x++){
      const at=y*stride+x,left=x>=4?rgba[at-4]:0,up=y>0?rgba[at-stride]:0,corner=x>=4&&y>0?rgba[at-stride-4]:0;
      const prediction=[0,left,up,Math.floor((left+up)/2),paeth(left,up,corner)][filter];
      rgba[at]=(raw[y*(stride+1)+1+x]+prediction)&255;
    }
  }
  return {width,height,rgba};
}

for(const name of Object.keys(WALK_CHARACTERS))for(const suffix of ['','-actions']){
  test(`${name}${suffix}: all complete frames share the same ground line without clipping`,()=>{
    const meta=JSON.parse(readFileSync(new URL(`../public/assets/walk/${name}${suffix}.json`,import.meta.url),'utf8'));
    const png=rgbaPng(readFileSync(new URL(`../public/assets/walk/${name}${suffix}.png`,import.meta.url)));
    assert.equal(png.width,512);assert.equal(png.height,256*(meta.frameCount/2));
    assert.ok(meta.contentHeight>100 && meta.contentHeight<=224.01);
    const bottoms=[];
    for(let frame=0;frame<meta.frameCount;frame++){
      let minX=256,maxX=-1,minY=256,maxY=-1;
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const pixel=((Math.floor(frame/2)*256+y)*png.width+(frame%2)*256+x)*4;
        if(png.rgba[pixel+3]>16){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
      }
      assert.ok(minX>0 && maxX<255 && minY>0,`${name}${suffix} frame ${frame} clipped at ${minX},${minY},${maxX}`);
      assert.ok(maxY>=meta.ground-2 && maxY<=meta.ground+1,`frame ${frame} bottom ${maxY} differs from ground ${meta.ground}`);
      bottoms.push(maxY);
    }
    assert.ok(Math.max(...bottoms)-Math.min(...bottoms)<=1);
  });
}

test('knight action atlas keeps six 256px frames on the shared 244px ground',()=>{
  const meta=JSON.parse(readFileSync(new URL('../public/assets/walk/knight-actions.json',import.meta.url),'utf8'));
  assert.equal(meta.frameSize,256);
  assert.equal(meta.frameCount,6);
  assert.equal(meta.ground,244);
  assert.equal(meta.contentHeight,188);
});

test('gait depends on distance, with the same phase at different render rates',()=>{
  for(const {stride} of Object.values(WALK_CHARACTERS)){
    let at30=0,at120=0;
    for(let i=0;i<30;i++)at30=advanceWalkPhase(at30,100/30,stride);
    for(let i=0;i<120;i++)at120=advanceWalkPhase(at120,100/120,stride);
    assert.ok(Math.abs(at30-at120)<1e-10);
    assert.ok(Math.abs(advanceWalkPhase(.25,stride,stride)-.25)<1e-10);
  }
});

test('stopping, pausing and teleporting do not add a spurious step',()=>{
  const walk=Object.assign(Object.create(WholeBodyWalk.prototype),{
    phase:0,lastX:0,config:{stride:60},container:{scaleX:1},sprite:{setFrame(frame){this.frame=frame;}},
  });
  walk.follow(15,true,-1,1/60);assert.equal(walk.phase,.25);
  walk.follow(15,false,-1,1/60);assert.equal(walk.phase,.25);
  walk.follow(30,true,1,1/60,true);assert.equal(walk.phase,.25);
  walk.follow(500,true,1,1/60);assert.equal(walk.phase,.25);
  walk.follow(515,true,1,1/60);assert.equal(walk.phase,.5);
});

test('mounted knight keeps one rider pose while the horse walks and changes direction',()=>{
  const image=(x,y,key)=>({x,y,key,height:1305,frame:0,rotation:0,
    setOrigin(){return this;},setScale(scale){this.scale=scale;return this;},setFrame(frame){this.frame=frame;return this;},
  });
  const scene={add:{image,container:()=>({scaleX:1,add(){},setVisible(visible){this.visible=visible;return this;}})},cache:{json:{get:()=>({ground:244,frameSize:256,contentHeight:180})}}};
  const walker=new WholeBodyWalk(scene,{x:0,add(){}},'knight');
  assert.equal(walker.rider.scale,150/989);
  assert.equal(walker.rider.y,-100);
  const riderPose={...walker.rider};const horseFrames=new Set();
  for(let i=1;i<=8;i++){
    walker.follow(i*15,true,i<5?-1:1,1/60);horseFrames.add(walker.sprite.frame);
    assert.deepEqual(walker.rider,riderPose);
  }
  assert.equal(horseFrames.size,4);
  assert.equal(walker.container.scaleX,-1);
});

test('gear-only knight pose driver stays hidden while its walk frame and facing advance',()=>{
  const containers=[];
  const image=(x,y,key,frame)=>({x,y,key,height:1305,frame:frame??0,
    setOrigin(){return this;},setScale(){return this;},setFrame(next){this.frame=next;return this;},
  });
  const scene={add:{image,container:()=>{const container={scaleX:1,visible:true,add(){},setVisible(visible){this.visible=visible;return this;}};containers.push(container);return container;}},cache:{json:{get:()=>({ground:244,frameSize:256,contentHeight:180})}}};
  const parent={x:0,add(){}};
  const driver=new WholeBodyWalk(scene,parent,'knight',{renderBase:false});

  assert.equal(driver.container.visible,false);
  assert.ok(driver.sprite);
  assert.ok(driver.rider);
  driver.setVisible(true);
  assert.equal(driver.container.visible,false);
  driver.follow(30,true,1,1/60);
  assert.equal(driver.frame,1);
  assert.equal(driver.sprite.frame,1);
  assert.equal(driver.container.scaleX,-1);
  driver.follow(60,true,1,1/60);
  assert.equal(driver.frame,2);
  assert.equal(driver.sprite.frame,2);
  assert.equal(driver.container.visible,false);

  const enemy=new WholeBodyWalk(scene,parent,'boar');
  assert.equal(enemy.container.visible,true);
  enemy.setVisible(false);
  assert.equal(enemy.container.visible,false);
});
