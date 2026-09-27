import Phaser from 'phaser';
import { BALANCE, GEAR_SLOT, RARITY_COLOR } from '../data/balance.js';
import { resolveContact } from '../domain/combat.js';
import { createInitialState, derivePlayerStats, rollGear, tryStoreDrop } from '../domain/gear.js';
import { chooseLevelUpStat, completeStage, getStageEnemyStats, grantXp, retryStage } from '../domain/progression.js';
import { createButton } from '../ui/components.js';

const WORLD_WIDTH = 11200;
const FLOOR_Y = 560;
const PLAYER_WIDTH = 64;
const ENEMY_WIDTH = 70;

function rarityTint(item, fallback) {
  return item ? RARITY_COLOR[item.rarity] : fallback;
}

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('BattleScene');
    this.contactPairs = new Set();
    this.groundDrops = [];
    this.enemies = [];
    this.combatPaused = false;
    this.finished = false;
  }

  init(data = {}) {
    this.gameState = data.gameState ?? createInitialState();
    this.chapter = data.chapter ?? this.gameState.progression.chapter;
    this.stage = data.stage ?? this.gameState.progression.currentStage;
    this.isReplay = Boolean(data.isReplay);
    this.transitioning = false;
    this.saveState = typeof data.saveState === 'function' ? data.saveState : () => {};
    this.stageSnapshot = data.stageSnapshot ?? this.gameState;
    this.normalDefeated = 0;
    this.contactPairs = new Set();
    this.groundDrops = [];
    this.enemies = [];
    this.finished = false;
    this.combatPaused = false;
  }

  create() {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, 720);
    this.drawWorld();
    this.createPlayer();
    this.spawnStage();
    this.cameras.main.startFollow(this.player.view, false, 1, 0);
    this.cameras.main.setDeadzone(1280 * 0.45, 720);
    this.cursors = this.input.keyboard.addKeys({ left:'A', right:'D' });
    this.touchDirection = 0;
    this.input.on('pointerdown', (pointer) => {
      if (!this.isPortrait()) this.touchDirection = pointer.x < this.scale.width / 2 ? -1 : 1;
    });
    this.input.on('pointerup', () => { this.touchDirection = 0; });
    this.input.on('pointerupoutside', () => { this.touchDirection = 0; });
    this.createHud();
    if (this.isPortrait()) this.combatPaused = true;
    this.resizeHandler = () => this.updatePortraitState();
    this.scale.on('resize', this.resizeHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.resizeHandler));
  }

  isPortrait() {
    return typeof window !== 'undefined' && window.matchMedia('(orientation: portrait)').matches;
  }

  updatePortraitState() {
    if (this.isPortrait()) {
      this.touchDirection = 0;
      this.combatPaused = true;
      this.showMessage('가로 화면으로 돌려 주세요.');
    } else if (!this.finished && !this.levelModal) {
      this.combatPaused = false;
      this.clearMessage();
    }
  }

  drawWorld() {
    this.add.rectangle(WORLD_WIDTH / 2, 360, WORLD_WIDTH, 720, 0x172331);
    this.add.rectangle(WORLD_WIDTH / 2, 465, WORLD_WIDTH, 190, 0x253544);
    for (let x = 300; x < WORLD_WIDTH; x += 760) {
      const height = 90 + ((x / 760) % 4) * 24;
      this.add.rectangle(x, FLOOR_Y - height / 2, 180, height, 0x304052, 0.55);
      this.add.rectangle(x + 42, FLOOR_Y - height / 2 - 12, 10, 18, 0x46586a, 0.7);
    }
    this.add.rectangle(WORLD_WIDTH / 2, FLOOR_Y + 80, WORLD_WIDTH, 160, 0x20252b);
    const groundLine = this.add.rectangle(WORLD_WIDTH / 2, FLOOR_Y, WORLD_WIDTH, 4, 0xb19361);
    groundLine.setAlpha(0.85);
  }

  createPlayer() {
    const stats = derivePlayerStats(this.gameState);
    this.player = {
      x: 120,
      currentHp: this.gameState.player.currentHp,
      maxHp: stats.maxHp,
      stats,
      view: this.add.container(120, FLOOR_Y),
    };
    const horse = this.gameState.equipment[GEAR_SLOT.HORSE];
    const armor = this.gameState.equipment[GEAR_SLOT.ARMOR];
    const helmet = this.gameState.equipment[GEAR_SLOT.HELMET];
    const gloves = this.gameState.equipment[GEAR_SLOT.GLOVES];
    const boots = this.gameState.equipment[GEAR_SLOT.BOOTS];
    const spear = this.gameState.equipment[GEAR_SLOT.SPEAR];
    this.player.view.add([
      this.add.ellipse(-5, -17, 82, 38, rarityTint(horse, 0x634a37)),
      this.add.ellipse(31, -28, 30, 25, rarityTint(horse, 0x785740)),
      this.add.rectangle(-24, -2, 8, 27, 0x302d2d),
      this.add.rectangle(7, -2, 8, 27, 0x302d2d),
      this.add.rectangle(25, -2, 8, 27, 0x302d2d),
      this.add.rectangle(-1, -67, 31, 48, rarityTint(armor, 0x728495)),
      this.add.rectangle(-2, -91, 25, 21, rarityTint(helmet, 0xc4ad7b)),
      this.add.rectangle(-18, -47, 10, 23, rarityTint(gloves, 0xb9c5ce)),
      this.add.rectangle(18, -47, 10, 23, rarityTint(gloves, 0xb9c5ce)),
      this.add.rectangle(-16, -9, 13, 9, rarityTint(boots, 0x7b634b)),
      this.add.rectangle(13, -9, 13, 9, rarityTint(boots, 0x7b634b)),
      this.add.rectangle(41, -66, 6, 91, rarityTint(spear, 0xd4c9ad)).setAngle(58),
      this.add.triangle(78, -101, 0, 22, 18, 0, 18, 30, rarityTint(spear, 0xe8e0cc)).setAngle(30),
      this.add.ellipse(1, -117, 27, 25, rarityTint(helmet, 0xc4ad7b)),
      this.add.rectangle(11, -111, 21, 5, 0x18212a),
    ]);
    this.player.view.setDepth(10);
  }

  spawnStage() {
    for (let index = 0; index < BALANCE.normalEnemyCount; index += 1) {
      const x = 700 + index * 950;
      this.createEnemy(x, false, index + 1);
    }
    this.hasBoss = this.stage % 5 === 0;
  }

  createEnemy(x, isBoss, index = 0) {
    const stats = getStageEnemyStats(this.chapter, this.stage, isBoss);
    const scale = isBoss ? 1.65 : 1;
    const width = ENEMY_WIDTH * scale;
    const container = this.add.container(x, FLOOR_Y);
    const bodyColor = isBoss ? 0x71394a : 0x8e5947;
    container.add([
      this.add.ellipse(0, -25 * scale, 55 * scale, 62 * scale, bodyColor),
      this.add.rectangle(-7 * scale, -61 * scale, 39 * scale, 24 * scale, isBoss ? 0xa8684f : 0xba805c),
      this.add.rectangle(-16 * scale, -4 * scale, 12 * scale, 32 * scale, 0x392c2d),
      this.add.rectangle(14 * scale, -4 * scale, 12 * scale, 32 * scale, 0x392c2d),
      this.add.triangle(22 * scale, -61 * scale, 0, 17 * scale, 13 * scale, 0, 19 * scale, 19 * scale, 0xb6a58b),
    ]);
    const barWidth = isBoss ? 150 : 86;
    const barY = -103 * scale;
    container.add(this.add.rectangle(0, barY, barWidth, 9, 0x1b1b1b));
    const fill = this.add.rectangle(-barWidth / 2, barY, barWidth, 7, isBoss ? 0xe15052 : 0xd86d51).setOrigin(0, 0.5);
    container.add(fill);
    if (isBoss) {
      const label = this.add.text(0, -145, '보스', { fontFamily:'sans-serif', fontSize:'22px', color:'#ffcf45', stroke:'#202020', strokeThickness:3 }).setOrigin(0.5);
      container.add(label);
    }
    this.enemies.push({
      id: isBoss ? 'boss' : 'enemy-' + index,
      x,
      width,
      currentHp: stats.maxHp,
      maxHp: stats.maxHp,
      attack: stats.attack,
      defense: stats.defense,
      isBoss,
      active: true,
      view: container,
      healthFill: fill,
      healthBarWidth: barWidth,
    });
  }

  createHud() {
    this.hud = this.add.container(22, 16).setScrollFactor(0).setDepth(100);
    const bg = this.add.rectangle(260, 48, 520, 92, 0x101820, 0.9).setOrigin(0, 0);
    bg.setStrokeStyle(1, 0x68798a);
    this.chapterText = this.add.text(14, 10, '', { fontFamily:'sans-serif', fontSize:'17px', color:'#f4e6bf' });
    this.playerText = this.add.text(14, 39, '', { fontFamily:'sans-serif', fontSize:'14px', color:'#e4ebf1' });
    this.hpBack = this.add.rectangle(14, 69, 330, 13, 0x313b45).setOrigin(0, 0);
    this.hpFill = this.add.rectangle(14, 69, 330, 13, 0x54c17a).setOrigin(0, 0);
    this.enemyText = this.add.text(360, 40, '', { fontFamily:'sans-serif', fontSize:'14px', color:'#f2c4a5' });
    this.hud.add([bg,this.chapterText,this.playerText,this.hpBack,this.hpFill,this.enemyText]);
    this.updateHud();
  }

  updateHud() {
    if (!this.hud) return;
    const left = Math.max(0, this.enemies.filter((enemy) => enemy.active && !enemy.isBoss).length);
    const boss = this.enemies.some((enemy) => enemy.active && enemy.isBoss);
    this.chapterText.setText(this.chapter + '회차 · ' + this.stage + '스테이지' + (this.isReplay ? ' · 반복 파밍 XP 30%' : ''));
    this.playerText.setText('Lv.' + this.gameState.player.level + '   HP ' + this.player.currentHp + '/' + this.player.maxHp + '   XP ' + this.gameState.player.xp + '/' + this.gameState.player.xpToNext);
    this.hpFill.setScale(this.player.maxHp ? Math.max(0, this.player.currentHp / this.player.maxHp) : 0, 1);
    this.enemyText.setText('적 ' + left + (boss ? ' · 보스 등장' : ''));
  }

  update(time, delta) {
    if (this.finished || this.combatPaused) return;
    if (this.isPortrait()) {
      this.updatePortraitState();
      return;
    }
    if (this.gameState.player.pendingLevelUps > 0) {
      this.showLevelUp();
      return;
    }
    const left = this.cursors.left.isDown;
    const right = this.cursors.right.isDown;
    const direction = this.touchDirection || (left === right ? 0 : left ? -1 : 1);
    this.player.x = Phaser.Math.Clamp(this.player.x + direction * this.player.stats.moveSpeed * (delta / 1000), 45, WORLD_WIDTH - 45);
    this.player.view.x = this.player.x;
    this.handleContacts();
    if (this.finished) return;
    this.collectDrops();
    this.updateHud();
    if (this.player.currentHp <= 0) this.showGameOver();
  }

  getPlayerEffects() {
    return Object.values(this.gameState.equipment).flatMap((item) => item?.effects ?? []);
  }

  handleContacts() {
    for (const enemy of this.enemies) {
      if (!enemy.active) {
        this.contactPairs.delete(enemy.id);
        continue;
      }
      const overlapping = Math.abs(this.player.x - enemy.x) <= (PLAYER_WIDTH + enemy.width) / 2;
      if (!overlapping) {
        this.contactPairs.delete(enemy.id);
        continue;
      }
      if (this.contactPairs.has(enemy.id)) continue;
      this.contactPairs.add(enemy.id);
      const result = resolveContact({
        playerStats: { ...this.player.stats, currentHp:this.player.currentHp },
        enemyStats: enemy,
        playerEffects: this.getPlayerEffects(),
      });
      enemy.currentHp = result.enemyHp;
      this.player.currentHp = result.playerHp;
      this.gameState = { ...this.gameState, player:{ ...this.gameState.player, currentHp:this.player.currentHp } };
      this.saveState(this.gameState);
      enemy.healthFill.setScale(Math.max(0, enemy.currentHp / enemy.maxHp), 1);
      if (result.critical) {
        this.player.view.setAlpha(0.6);
        this.time.delayedCall(110, () => this.player?.view?.setAlpha(1));
      }
      this.showDamageText(enemy.x, FLOOR_Y - 115, result.enemyDamage, result.critical, 0xffd36e);
      if (this.player.currentHp <= 0) {
        this.gameState = retryStage(this.stageSnapshot, this.gameState).state;
        this.saveState(this.gameState);
        this.showGameOver();
        return;
      }
      if (result.enemyDefeated) this.defeatEnemy(enemy);
      this.applyKnockback(enemy.x);
      this.updateHud();
    }
  }

  applyKnockback(enemyX) {
    const direction = this.player.x <= enemyX ? -1 : 1;
    this.player.x = Phaser.Math.Clamp(this.player.x + direction * BALANCE.knockbackPixels, 45, WORLD_WIDTH - 45);
    this.player.view.x = this.player.x;
  }

  showDamageText(x, y, damage, critical, color) {
    if (damage <= 0) return;
    const label = this.add.text(x, y, (critical ? '치명타 ' : '') + Math.ceil(damage), {
      fontFamily:'sans-serif', fontSize:critical?'21px':'16px', color:'#'+color.toString(16),
      stroke:'#13181e', strokeThickness:3,
    }).setOrigin(0.5).setDepth(50);
    this.tweens.add({ targets:label, y:y-44, alpha:0, duration:620, onComplete:()=>label.destroy() });
  }

  defeatEnemy(enemy) {
    enemy.active = false;
    enemy.view.setVisible(false);
    this.normalDefeated += enemy.isBoss ? 0 : 1;
    if (!enemy.isBoss) {
      const reward = grantXp(this.gameState, BALANCE.xpRewards.normalEnemy, this.isReplay);
      if (reward.ok) this.gameState = reward.state;
    }
    if (enemy.isBoss) {
      this.dropGear(enemy.x, true);
      this.finishStage();
      return;
    }
    if (Math.random() < BALANCE.normalDropChance) this.dropGear(enemy.x, false);
    if (this.normalDefeated >= BALANCE.normalEnemyCount) {
      if (this.hasBoss) this.createEnemy(10500, true);
      else this.finishStage();
    }
    this.saveState(this.gameState);
  }

  dropGear(x, guaranteed) {
    const item = rollGear({ stageIndex:this.stage });
    const color = RARITY_COLOR[item.rarity];
    const gem = this.add.rectangle(x, FLOOR_Y - 15, 24, 24, color).setAngle(45).setStrokeStyle(2, 0xffffff).setDepth(12);
    const label = this.add.text(x, FLOOR_Y - 48, item.rarity.slice(0,1).toUpperCase(), { fontFamily:'sans-serif',fontSize:'13px',color:'#111111',backgroundColor:'#'+color.toString(16).padStart(6,'0'),padding:{x:4,y:2} }).setOrigin(0.5).setDepth(13);
    this.groundDrops.push({ item, x, view:gem, label, guaranteed });
    this.saveState(this.gameState);
  }

  collectDrops() {
    for (const drop of this.groundDrops) {
      if (!drop.view.active || Math.abs(this.player.x - drop.x) > 45) continue;
      const result = tryStoreDrop(this.gameState, drop.item);
      if (!result.ok) continue;
      this.gameState = result.state;
      drop.view.destroy();
      drop.label.destroy();
      drop.collected = true;
      this.saveState(this.gameState);
    }
    this.groundDrops = this.groundDrops.filter((drop) => !drop.collected);
  }

  showLevelUp() {
    if (this.levelModal) return;
    this.combatPaused = true;
    this.levelModal = this.add.container(0, 0).setScrollFactor(0).setDepth(200);
    this.levelModal.add(this.add.rectangle(640, 360, 1280, 720, 0x090d12, 0.78));
    this.levelModal.add(this.add.rectangle(640, 355, 470, 300, 0x202d3b).setStrokeStyle(2, 0xd8ba77));
    this.levelModal.add(this.add.text(640, 250, '레벨 업!  능력치를 선택하세요', { fontFamily:'sans-serif',fontSize:'23px',color:'#ffdf94' }).setOrigin(0.5));
    const choices=[['attack','공격력 +2'],['defense','방어력 +5'],['maxHp','최대 HP +10']];
    this.levelModalButtons=[];
    choices.forEach(([key,label],index)=>{
      const button=createButton(this,{x:445,y:292+index*66,width:390,height:52,label,onClick:()=>{
        const result=chooseLevelUpStat(this.gameState,key);
        if(!result.ok)return;
        this.gameState=result.state;
        this.player.stats=derivePlayerStats(this.gameState);
        this.player.maxHp=this.player.stats.maxHp;
        this.player.currentHp=Math.min(this.player.maxHp,this.gameState.player.currentHp);
        this.gameState={...this.gameState,player:{...this.gameState.player,currentHp:this.player.currentHp}};
        this.saveState(this.gameState);
        this.levelModalButtons.forEach((levelButton)=>levelButton.destroy());
        this.levelModalButtons=[];
        this.levelModal.destroy();
        this.levelModal=null;
        this.combatPaused=this.isPortrait();
        if(this.gameState.player.pendingLevelUps>0)this.showLevelUp();
        else if(this.pendingStageClear){const next=this.pendingStageClear;this.pendingStageClear=null;this.showStageClear(next.nextChapter,next.nextStage);}
        this.updateHud();
      }});
      button.setDepth(201);
      this.levelModalButtons.push(button);
    });
  }

  showMessage(message) {
    if (this.messageText?.active) return;
    this.messageText=this.add.text(640,360,message,{fontFamily:'sans-serif',fontSize:'28px',color:'#ffffff',backgroundColor:'#101820',padding:{x:24,y:18}}).setOrigin(0.5).setScrollFactor(0).setDepth(300);
  }

  clearMessage() {
    this.messageText?.destroy();
    this.messageText=null;
  }

  finishStage() {
    if (this.finished) return;
    this.finished=true;
    this.combatPaused=true;
    const completed=completeStage(this.gameState,this.chapter,this.stage);
    if (!completed.ok) return;
    this.gameState={...completed.state,progression:{...completed.state.progression,chapter:completed.nextChapter,currentStage:completed.nextStage}};
    this.player.currentHp=this.gameState.player.currentHp;
    this.saveState(this.gameState);
    this.updateHud();
    if(this.gameState.player.pendingLevelUps>0){
      this.pendingStageClear={nextChapter:completed.nextChapter,nextStage:completed.nextStage};
      this.showLevelUp();
    }else this.showStageClear(completed.nextChapter,completed.nextStage);
  }

  showStageClear(nextChapter,nextStage) {
    const overlay=this.add.container(0,0).setScrollFactor(0).setDepth(250);
    overlay.add(this.add.rectangle(640,360,1280,720,0x080c11,0.78));
    overlay.add(this.add.rectangle(640,345,560,300,0x202d3b).setStrokeStyle(2,0xd8ba77));
    overlay.add(this.add.text(640,245,'스테이지 완료',{fontFamily:'sans-serif',fontSize:'30px',color:'#ffdf94'}).setOrigin(0.5));
    overlay.add(this.add.text(640,290,this.chapter+'-'+this.stage+' 클리어 · XP +'+BALANCE.xpRewards.stageClear,{fontFamily:'sans-serif',fontSize:'17px',color:'#e4ebf1'}).setOrigin(0.5));
    createButton(this,{x:355,y:350,width:230,height:58,label:'마을로',onClick:()=>{
      if(this.transitioning)return;
      this.transitioning=true;
      this.scene.start('TownScene',{gameState:this.gameState,saveState:this.saveState,unlockedStageId:nextChapter+'-'+nextStage});
    }}).setDepth(251);
    createButton(this,{x:600,y:350,width:325,height:58,label:'다음 스테이지 '+nextChapter+'-'+nextStage,onClick:()=>{
      if(this.transitioning)return;
      this.transitioning=true;
      const snapshot=typeof structuredClone==='function'?structuredClone(this.gameState):JSON.parse(JSON.stringify(this.gameState));
      this.scene.start('BattleScene',{gameState:this.gameState,saveState:this.saveState,chapter:nextChapter,stage:nextStage,isReplay:false,stageSnapshot:snapshot});
    }}).setDepth(251);
  }

  showGameOver() {
    if (this.finished) return;
    this.finished=true;
    this.combatPaused=true;
    const overlay=this.add.container(0,0).setScrollFactor(0).setDepth(250);
    overlay.add(this.add.rectangle(640,360,1280,720,0x080c11,0.8));
    overlay.add(this.add.rectangle(640,345,520,260,0x2b2225).setStrokeStyle(2,0xb65e62));
    overlay.add(this.add.text(640,255,'쓰러졌습니다',{fontFamily:'sans-serif',fontSize:'29px',color:'#ffb6ad'}).setOrigin(0.5));
    overlay.add(this.add.text(640,300,'이번 도전의 장비와 재료는 입장 시점으로 돌아갑니다.',{fontFamily:'sans-serif',fontSize:'15px',color:'#e2d0cd'}).setOrigin(0.5));
    createButton(this,{x:480,y:365,width:320,height:58,label:'다시 시작',onClick:()=>{
      if(this.transitioning)return;
      this.transitioning=true;
      const result=retryStage(this.stageSnapshot,this.gameState);
      this.saveState(result.state);
      this.scene.restart({gameState:result.state,saveState:this.saveState,chapter:this.chapter,stage:this.stage,isReplay:this.isReplay,stageSnapshot:result.state});
    }}).setDepth(251);
  }
}
