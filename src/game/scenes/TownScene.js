import Phaser from 'phaser';
import { BALANCE, GEAR_SLOT, RARITY_COLOR } from '../data/balance.js';
import { createInitialState, equipGear, dismantleGear, upgradeGear, derivePlayerStats, getGearStatSummary, getGearUpgradeCost } from '../domain/gear.js';
import { stageId } from '../domain/progression.js';
import { createButton, createPanel, drawRarityFrame } from '../ui/components.js';

const SLOT_LABEL = { helmet:'투구', armor:'갑옷', gloves:'장갑', boots:'신발', spear:'창', horse:'말' };
const RARITY_LABEL = { common:'커먼', uncommon:'언커먼', rare:'레어', unique:'유니크', legendary:'레전더리' };
const EFFECT_LABEL = { bonusDamage:'추가 피해', lifeSteal:'생명력 흡수', damageReduction:'피해 감소', thorns:'가시 반사' };
const STAT_LABEL = { maxHp:'최대 HP', attack:'공격력', defense:'방어력', critChance:'치명타 확률', critMultiplier:'치명타 배율', moveSpeedPercent:'이동 속도' };
const SLOT_ORDER = Object.values(GEAR_SLOT);

function formatStat(key, value) {
  if (key === 'critChance' || key === 'moveSpeedPercent') return (value * 100).toFixed(1) + '%';
  if (key === 'critMultiplier') return 'x' + value.toFixed(2);
  return String(Math.ceil(value));
}
function rarityHex(rarity) {
  return '#' + (0x1000000 + RARITY_COLOR[rarity]).toString(16).slice(1);
}
function stageName(id) {
  const [chapter, stage] = id.split('-');
  return chapter + '회차 ' + stage + '스테이지';
}

export class TownScene extends Phaser.Scene {
  constructor() {
    super('TownScene');
    this.inventoryOffset = 0;
    this.selectedItem = null;
  }

  init(data = {}) {
    this.transitioning = false;
    this.upgradeFeedback = null;
    this.gameState = data.gameState ?? createInitialState();
    this.saveState = typeof data.saveState === 'function' ? data.saveState : () => {};
    this.rankedRunClient = data.rankedRunClient;
    this.selectedStageId = data.unlockedStageId ?? stageId(
      this.gameState.progression.chapter,
      this.gameState.progression.currentStage,
    );
    this.replayXpMultiplier = data.replayXpMultiplier ?? BALANCE.replayXpMultiplier;
  }

  create() {
    this.input.on('wheel', (pointer, over, deltaX, deltaY) => {
      if (pointer.x >= 470 && pointer.x <= 900 && pointer.y >= 130 && pointer.y <= 610) {
        const maxOffset = Math.max(0, this.gameState.inventory.length - 10);
        this.inventoryOffset = Math.max(0, Math.min(maxOffset, this.inventoryOffset + Math.sign(deltaY) * 2));
        this.refresh();
      }
    });
    this.refresh();
  }

  commitState(nextState) {
    this.gameState = nextState;
    this.saveState(this.gameState);
    this.refresh();
  }

  refresh() {
    this.children.removeAll(true);
    this.renderTown();
  }

  renderTown() {
    const { progression, player, materials, inventory } = this.gameState;
    const stats = derivePlayerStats(this.gameState);
    this.add.rectangle(640, 360, 1280, 720, 0x121a23);
    this.add.text(32, 20, '마창기사 · 마을', { fontFamily:'sans-serif', fontSize:'27px', color:'#f4e6bf' });
    this.add.text(345, 25, progression.chapter + '회차 · 해금 ' + progression.unlockedChapter + '-' + progression.unlockedStage, { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df' });
    this.add.text(700, 18, 'Lv.' + player.level + '  XP ' + player.xp + '/' + player.xpToNext, { fontFamily:'sans-serif', fontSize:'16px', color:'#f4e6bf' });
    this.add.text(700, 45, 'HP ' + player.currentHp + '/' + stats.maxHp + '   ATK ' + stats.attack + '   DEF ' + stats.defense + '   치명타 ' + (stats.critChance * 100).toFixed(1) + '%', { fontFamily:'sans-serif', fontSize:'14px', color:'#b8c7d5' });
    this.add.text(1115, 23, '재료 ' + materials, { fontFamily:'sans-serif', fontSize:'18px', color:'#ffcf45' });

    createPanel(this, { x:32, y:92, width:418, height:520, title:'장착 장비' });
    createPanel(this, { x:465, y:92, width:438, height:520, title:'보관함 ' + inventory.length + '/' + BALANCE.inventoryCapacity });
    createPanel(this, { x:918, y:92, width:330, height:520, title:'장비 정보' });
    this.renderEquipment();
    this.renderInventory();
    this.renderSelectedItem();
    this.renderStagePanel();
  }

  renderEquipment() {
    SLOT_ORDER.forEach((slot, index) => {
      const item = this.gameState.equipment[slot];
      const x = 46;
      const y = 126 + index * 75;
      const card = this.add.rectangle(x + 194, y + 29, 388, 64, 0x263342);
      card.setStrokeStyle(1, 0x56687a);
      this.add.text(x + 12, y + 7, SLOT_LABEL[slot] + ' · ' + (item ? RARITY_LABEL[item.rarity] : '비어 있음'), { fontFamily:'sans-serif', fontSize:'15px', color:item ? rarityHex(item.rarity) : '#9ba7b3' });
      if (item) {
        this.add.text(x + 12, y + 33, 'Lv.' + item.level + '  ' + getGearStatSummary(item).map(({key,value}) => STAT_LABEL[key] + ' +' + formatStat(key,value)).join('  '), { fontFamily:'sans-serif', fontSize:'12px', color:'#e6edf3' });
        drawRarityFrame(this, x + 1, y - 2, 386, 62, item.rarity);
      }
      card.setInteractive(new Phaser.Geom.Rectangle(0,0,388,64), Phaser.Geom.Rectangle.Contains).on('pointerdown', () => {
        this.selectedItem = item ? { type:'equipment', id:item.id } : null;
        this.refresh();
      });
    });
  }

  renderInventory() {
    const inventory = this.gameState.inventory;
    const viewport = { x:479, y:132, width:410, height:458 };
    const grid = this.add.container(0, 0);
    inventory.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2) - Math.floor(this.inventoryOffset / 2);
      const x = 478 + column * 204;
      const y = 136 + row * 86;
      if (y + 78 < viewport.y || y > viewport.y + viewport.height) return;
      const card = this.add.rectangle(x + 96, y + 37, 192, 74, 0x263342);
      card.setStrokeStyle(1, 0x596a7b);
      const label = this.add.text(x + 8, y + 5, SLOT_LABEL[item.slot] + ' · ' + RARITY_LABEL[item.rarity] + ' · Lv.' + item.level, { fontFamily:'sans-serif', fontSize:'13px', color:rarityHex(item.rarity) });
      const stats = this.add.text(x + 8, y + 27, getGearStatSummary(item).map(({key,value}) => STAT_LABEL[key] + ' +' + formatStat(key,value)).join(' / '), { fontFamily:'sans-serif', fontSize:'11px', color:'#e6edf3', wordWrap:{width:176} });
      const select = this.add.rectangle(x + 96, y + 37, 192, 74, 0xffffff, 0);
      select.setInteractive(new Phaser.Geom.Rectangle(0,0,192,74), Phaser.Geom.Rectangle.Contains).on('pointerdown', () => {
        this.selectedItem = { type:'inventory', id:item.id };
        this.refresh();
      });
      grid.add([card, drawRarityFrame(this,x,y,192,74,item.rarity),label,stats,select]);
    });
    this.add.text(596, 592, inventory.length > 10 ? '마우스 휠로 보관함 스크롤' : '획득 장비는 이곳에 보관됩니다', { fontFamily:'sans-serif', fontSize:'12px', color:'#99a7b4' });
  }

  renderSelectedItem() {
    const selected = this.selectedItem;
    const item = selected
      ? selected.type === 'equipment'
        ? Object.values(this.gameState.equipment).find((candidate) => candidate?.id === selected.id)
        : this.gameState.inventory.find((candidate) => candidate.id === selected.id)
      : null;
    if (!item) {
      this.add.text(944, 136, '장비를 선택하면\n능력치와 행동을 볼 수 있습니다.', { fontFamily:'sans-serif', fontSize:'16px', color:'#aeb9c4', lineSpacing:8 });
      return;
    }
    this.add.text(940, 132, SLOT_LABEL[item.slot] + ' · ' + RARITY_LABEL[item.rarity] + '\n장비 레벨 ' + item.level + '/' + BALANCE.gearMaxLevel, { fontFamily:'sans-serif', fontSize:'17px', color:'#f4e6bf', lineSpacing:8 });
    let detailY = 194;
    for (const {key,value} of getGearStatSummary(item)) {
      this.add.text(942, detailY, STAT_LABEL[key] + '  +' + formatStat(key,value), { fontFamily:'sans-serif', fontSize:'14px', color:'#d8e0e8' });
      detailY += 25;
    }
    for (const effect of item.effects) {
      this.add.text(942, detailY, (EFFECT_LABEL[effect.id] ?? effect.id) + '  +' + (effect.value * 100).toFixed(1) + '%', { fontFamily:'sans-serif', fontSize:'13px', color:'#d5b2ff' });
      detailY += 23;
    }
    const y = Math.max(360, detailY + 14);
    if (selected.type === 'inventory') {
      const oldItem = this.gameState.equipment[item.slot];
      const canEquip = !oldItem || this.gameState.inventory.length < BALANCE.inventoryCapacity;
      createButton(this, { x:936,y,width:138,height:48,label:'장착',enabled:canEquip,onClick:() => {
        const result=equipGear(this.gameState,item.id);
        if(result.ok){this.selectedItem={type:'equipment',id:item.id};this.commitState(result.state);}
      }});
      createButton(this, { x:1084,y,width:148,height:48,label:'분해',onClick:() => {
        const result=dismantleGear(this.gameState,item.id);
        if(result.ok){this.selectedItem=null;this.commitState(result.state);}
      }});
    }
    const cost = getGearUpgradeCost(item.level);
    const canUpgrade = item.level < BALANCE.gearMaxLevel && this.gameState.materials >= cost;
    const upgradeY = selected.type === 'inventory' ? y + 58 : y;
    createButton(this, { x:936,y:upgradeY,width:296,height:48,label:item.level >= BALANCE.gearMaxLevel ? '최대 레벨' : '강화 · 재료 ' + cost,enabled:canUpgrade,onClick:() => {
      const result=upgradeGear(this.gameState,item.id);
      if (!result.ok) {
        this.upgradeFeedback = null;
        this.refresh();
        return;
      }
      this.upgradeFeedback = result.greatSuccess
        ? { itemId:item.id, message:'강화 대성공!' }
        : null;
      this.selectedItem={...selected};
      this.commitState(result.state);
    }});
    this.add.text(943, upgradeY + 53, '일반 능력치 1~5% · 특수 능력별 상승량\n대성공 5% · 상승량 2배', { fontFamily:'sans-serif', fontSize:'11px', color:'#9eacba' });
    if (this.upgradeFeedback?.itemId === item.id) {
      this.add.text(943, upgradeY + 82, this.upgradeFeedback.message, { fontFamily:'sans-serif', fontSize:'13px', color:'#ffcf45' });
    }
  }

  getStageOptions() {
    const { progression } = this.gameState;
    const nextId = stageId(progression.unlockedChapter, progression.unlockedStage);
    return [...new Set([...progression.clearedStageIds, nextId])];
  }

  renderStagePanel() {
    const options = this.getStageOptions();
    if (!options.includes(this.selectedStageId)) this.selectedStageId = options.at(-1);
    const selectedIndex = options.indexOf(this.selectedStageId);
    const isReplay = this.gameState.progression.clearedStageIds.includes(this.selectedStageId);
    createButton(this,{x:32,y:630,width:250,height:58,label:'◀ 파밍 스테이지',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex-1+options.length)%options.length];this.refresh();
    }});
    this.add.text(305, 635, (isReplay?'반복 도전 · XP '+Math.round(this.replayXpMultiplier*100)+'%':'신규 도전')+'\n'+stageName(this.selectedStageId), { fontFamily:'sans-serif',fontSize:'15px',color:'#f4e6bf',lineSpacing:3 });
    createButton(this,{x:688,y:630,width:250,height:58,label:'다음/선택 스테이지 ▶',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex+1)%options.length];this.refresh();
    }});
    createButton(this,{x:1000,y:630,width:248,height:58,label:'전투 출발',onClick:()=>this.startBattle(this.selectedStageId)});
  }

  async startBattle(selectedStageId) {
    if (this.transitioning) return;
    this.transitioning = true;
    const [chapter, stage] = selectedStageId.split('-').map(Number);
    const isReplay = this.gameState.progression.clearedStageIds.includes(selectedStageId);
    const gameState = {
      ...this.gameState,
      progression: { ...this.gameState.progression, chapter, currentStage:stage },
    };
    this.saveState(gameState);
    let ranked = { ranked: false, reason: 'ranking-unavailable' };
    if (this.rankedRunClient) {
      try {
        ranked = await this.rankedRunClient.prepareStage({ chapter, stage, gameState });
      } catch {
        ranked = { ranked: false, reason: 'ticket-request-failed' };
      }
    }
    const startState = ranked.gameState ?? gameState;
    const stageSnapshot = typeof structuredClone === 'function'
      ? structuredClone(startState)
      : JSON.parse(JSON.stringify(startState));
    this.scene.start('BattleScene', {
      gameState:startState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      rankedTicket:ranked.ranked ? ranked.ticket : null,
      rankedReason:ranked.reason,
      chapter,
      stage,
      isReplay,
      stageSnapshot,
    });
  }
}
