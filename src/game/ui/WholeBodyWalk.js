export const WALK_CHARACTERS = Object.freeze({
  goblin:{height:154,stride:60},
  brute:{height:178,stride:48},
  warlord:{height:242,stride:48},
  boar:{height:106,stride:52},
  knight:{height:190,walkHeight:145,stride:120,rider:{height:150,contentHeight:989,x:8,y:-100,origin:[.64,.66]}},
});

export function preloadWholeBodyWalks(scene) {
  for (const name of Object.keys(WALK_CHARACTERS)) {
    scene.load.spritesheet(`walk-${name}`,`/assets/walk/${name}.png`,{frameWidth:256,frameHeight:256});
    scene.load.json(`walk-${name}-meta`,`/assets/walk/${name}.json`);
  }
  scene.load.image('knight-rider','/assets/walk/knight-rider.png');
}

export function advanceWalkPhase(phase,distance,stride) {
  return ((phase+distance/stride)%1+1)%1;
}

export class WholeBodyWalk {
  constructor(scene,parent,name,{renderBase=true}={}) {
    if(typeof renderBase!=='boolean')throw new TypeError('WholeBodyWalk renderBase must be a boolean.');
    this.renderBase=renderBase;
    this.config=WALK_CHARACTERS[name];
    this.phase=0;
    this.lastX=parent.x;
    this.frame=0;
    this.container=scene.add.container(0,0);
    parent.add(this.container);
    const metadata=scene.cache.json.get(`walk-${name}-meta`);
    this.sprite=scene.add.image(0,0,`walk-${name}`,0)
      .setOrigin(.5,metadata.ground/metadata.frameSize)
      .setScale((this.config.walkHeight??this.config.height)/metadata.contentHeight);
    this.container.add(this.sprite);
    if(this.config.rider){
      const pose=this.config.rider;
      if(!Number.isFinite(pose.contentHeight)||pose.contentHeight<=0)throw new TypeError('Mounted rider content height is invalid.');
      this.rider=scene.add.image(pose.x,pose.y,'knight-rider')
        .setOrigin(...pose.origin);
      this.rider.setScale(pose.height/pose.contentHeight);
      this.container.add(this.rider);
    }
    this.container.setVisible(this.renderBase);
  }

  setVisible(visible){this.container.setVisible(this.renderBase&&Boolean(visible));return this;}
  setFacing(direction){this.container.scaleX=direction>0?-1:1;}

  follow(x,moving,direction,_delta,freeze=false) {
    const distance=Math.abs(x-this.lastX);
    this.lastX=x;
    this.setFacing(direction);
    if(freeze)return;
    // Horizontal teleports and knockback never advance the walking pose.
    if(moving && distance>0 && distance<70) {
      this.phase=advanceWalkPhase(this.phase,distance,this.config.stride);
      this.frame=Math.floor(this.phase*4)%4;
    } else if(!moving) {
      this.frame=this.phase<.5?0:2;
    }
    this.sprite.setFrame(this.frame);
  }
}
