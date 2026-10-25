import Phaser from 'phaser';
import { WholeBodyWalk, WALK_CHARACTERS, preloadWholeBodyWalks } from '../game/ui/WholeBodyWalk.js';
import { ENEMY_ANIMATIONS, ENEMY_SPRITE_SHEETS } from '../game/ui/enemyAnimations.js';
import { KNIGHT_ANIMATIONS } from '../game/ui/knightAnimations.js';

const settings={playing:true,speed:1,direction:-1,frame:0,character:'goblin',action:null};
const speeds={goblin:108,brute:72,warlord:60,boar:88,knight:240};
class WholeBodyPreview extends Phaser.Scene {
  preload(){
    preloadWholeBodyWalks(this);
    for(const name of Object.keys(WALK_CHARACTERS)){
      const key=name==='knight'?'knight':ENEMY_SPRITE_SHEETS[name].key;
      this.load.spritesheet(key,`/assets/walk/${name}-actions.png`,{frameWidth:256,frameHeight:256});
      this.load.json(`${name}-actions-meta`,`/assets/walk/${name}-actions.json`);
    }
  }
  create(){
    this.add.rectangle(600,300,1200,600,0x172331);
    this.add.text(600,36,'캐릭터 동작 미리보기',{fontSize:'23px',color:'#f5d79b'}).setOrigin(.5);
    this.poseDescription=this.add.text(600,78,'',{fontSize:'16px',color:'#aabcc9'}).setOrigin(.5);
    this.add.rectangle(600,492,1200,4,0xb19361);
    this.marks=Array.from({length:17},(_,i)=>this.add.rectangle(i*80,509,1,14,0x6b7d89));
    this.label=this.add.text(600,555,'',{fontSize:'18px',color:'#aec2d3'}).setOrigin(.5);
    for(const name of Object.keys(WALK_CHARACTERS)){
      const key=name==='knight'?'knight':ENEMY_SPRITE_SHEETS[name].key;
      for(const [action,definition] of Object.entries(name==='knight'?KNIGHT_ANIMATIONS:ENEMY_ANIMATIONS)){
        this.anims.create({key:`${name}-${action}`,frames:this.anims.generateFrameNumbers(key,{start:definition.start,end:definition.end}),frameRate:definition.frameRate,repeat:0});
      }
    }
    this.setCharacter(settings.character);
    window.wholeBodyPreview={scene:this,settings,setFrame:frame=>{
      this.restoreWalk();settings.playing=false;settings.frame=frame;this.walker.phase=frame/4;this.walker.sprite.setFrame(frame);document.querySelector('#play').textContent='재생';
    }};
  }
  setCharacter(name){
    this.actor?.destroy(true);
    settings.character=name;settings.action=null;settings.playing=true;settings.frame=0;
    this.poseDescription.setText(name==='knight'?'기사 상체 고정 · 말의 걸음과 망토 움직임':'걷기 · 방향 전환 · 피격 후 복귀 · 쓰러짐');
    this.actor=this.add.container(600,490).setScale(1.5);
    this.walker=new WholeBodyWalk(this,this.actor,name);this.worldX=600;
    const metadata=this.cache.json.get(`${name}-actions-meta`);
    const key=name==='knight'?'knight':ENEMY_SPRITE_SHEETS[name].key;
    this.actionSprite=this.add.sprite(0,0,key,0).setOrigin(.5,244/256).setScale(WALK_CHARACTERS[name].height/metadata.contentHeight).setVisible(false);
    this.actor.add(this.actionSprite);
    this.actionSprite.on('animationcomplete',()=>{
      if(settings.action==='defeat'){settings.playing=false;document.querySelector('#play').textContent='다시 걷기';}
      else this.restoreWalk();
    });
    document.querySelector('#play').textContent='일시정지';
  }
  restoreWalk(){settings.action=null;this.actionSprite.stop().setVisible(false);this.walker.setVisible(true);}
  action(name){settings.action=name;this.walker.setVisible(false);this.actionSprite.setFlipX(settings.direction>0).setVisible(true).play(`${settings.character}-${name}`);}
  update(_time,delta){
    const seconds=Math.min(delta,50)/1000*settings.speed;
    this.walker.setFacing(settings.direction);this.actionSprite.setFlipX(settings.direction>0);
    if(settings.playing && !settings.action){
      this.worldX+=settings.direction*speeds[settings.character]*seconds;
      this.walker.follow(this.worldX,true,settings.direction,seconds);
      settings.frame=this.walker.frame;
      for(let i=0;i<this.marks.length;i++)this.marks[i].x=((i*80-this.worldX*1.5)%1360+1360)%1360-80;
    }
    this.label.setText(settings.action??`${settings.frame+1} / 4`);
  }
}
new Phaser.Game({type:Phaser.CANVAS,parent:'preview',width:1200,height:600,backgroundColor:'#172331',scene:[WholeBodyPreview],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_HORIZONTALLY}});
document.querySelector('#play').onclick=event=>{
  if(settings.action==='defeat'){window.wholeBodyPreview.scene.restoreWalk();settings.playing=true;}
  else settings.playing=!settings.playing;
  event.target.textContent=settings.playing?'일시정지':'재생';
};
document.querySelector('#speed').onchange=event=>{settings.speed=Number(event.target.value);};
document.querySelector('#direction').onclick=()=>{settings.direction*=-1;};
document.querySelector('#step').onclick=()=>window.wholeBodyPreview?.setFrame((settings.frame+1)%4);
document.querySelector('#character').onchange=event=>window.wholeBodyPreview?.scene.setCharacter(event.target.value);
document.querySelector('#hit').onclick=()=>window.wholeBodyPreview?.scene.action('hit');
document.querySelector('#defeat').onclick=()=>window.wholeBodyPreview?.scene.action('defeat');
