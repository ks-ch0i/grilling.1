import Phaser from 'phaser';
import { BALANCE, GEAR_SLOT, RARITY_COLOR, getGearUpgradeBand } from '../data/balance.js';
import { createInitialState, equipGear, dismantleGear, upgradeGear, derivePlayerStats, getGearStatSummary, getGearUpgradeCost } from '../domain/gear.js';
import { allocateStatPoint, getStatResetCost, resetStatPoints, stageId } from '../domain/progression.js';
import { createButton, createPanel, drawRarityFrame } from '../ui/components.js';
import {
  clampInventoryScrollRow,
  getDragScrollRow,
  getInventoryTapItemId,
  hasInventoryDragExceededThreshold,
  removeInventoryInputHandlers,
} from '../ui/inventoryScroll.js';
import { RankingMarquee } from '../ui/RankingMarquee.js';

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
    this.inventoryScrollRow = 0;
    this.inventoryDrag = null;
    this.inventoryTap = null;
    this.selectedItem = null;
  }

  init(data = {}) {
    this.transitioning = false;
    this.upgradeFeedback = null;
    this.gameState = data.gameState ?? createInitialState();
    this.saveState = typeof data.saveState === 'function' ? data.saveState : () => {};
    this.rankedRunClient = data.rankedRunClient;
    this.pvpClient = data.pvpClient;
    this.rankingClient = data.rankingClient;
    this.pvpSearching = false;
    this.selectedStageId = data.unlockedStageId ?? stageId(
      this.gameState.progression.chapter,
      this.gameState.progression.currentStage,
    );
    this.replayXpMultiplier = data.replayXpMultiplier ?? BALANCE.replayXpMultiplier;
  }

  create() {
    this.rankingMarquee = new RankingMarquee(this, this.rankingClient);
    this.inventoryInputHandlers = {
      wheel: (pointer, over, deltaX, deltaY) => {
        if (pointer.x >= 470 && pointer.x <= 900 && pointer.y >= 190 && pointer.y <= 600) {
          const nextRow = clampInventoryScrollRow(
            this.inventoryScrollRow + Math.sign(deltaY),
            this.gameState.inventory.length,
          );
          if (nextRow !== this.inventoryScrollRow) {
            this.inventoryScrollRow = nextRow;
            this.refresh();
          }
        }
      },
      pointerdown: (pointer) => {
        this.inventoryDrag = pointer.x >= 470 && pointer.x <= 900 && pointer.y >= 190 && pointer.y <= 600
          ? {
            pointerId: pointer.id,
            startY: pointer.y,
            startRow: this.inventoryScrollRow,
            moved: false,
          }
          : null;
      },
      pointermove: (pointer) => {
        const drag = this.inventoryDrag;
        if (!drag || drag.pointerId !== pointer.id) return;
        if (hasInventoryDragExceededThreshold(drag.startY, pointer.y)) drag.moved = true;
        if (!drag.moved) return;
        const nextRow = getDragScrollRow(
          drag.startRow,
          drag.startY,
          pointer.y,
          this.gameState.inventory.length,
        );
        if (nextRow !== this.inventoryScrollRow) {
          this.inventoryScrollRow = nextRow;
          this.refresh();
        }
      },
      pointerup: (pointer) => this.finishInventoryPointer(pointer),
      pointerupoutside: (pointer) => this.finishInventoryPointer(pointer),
    };
    this.input.on('wheel', this.inventoryInputHandlers.wheel);
    this.input.on('pointerdown', this.inventoryInputHandlers.pointerdown);
    this.input.on('pointermove', this.inventoryInputHandlers.pointermove);
    this.input.on('pointerup', this.inventoryInputHandlers.pointerup);
    this.input.on('pointerupoutside', this.inventoryInputHandlers.pointerupoutside);
    this.refresh();
    this.onlineHandler = () => this.refresh();
    if (typeof window !== 'undefined') window.addEventListener('online', this.onlineHandler);
    if (typeof window !== 'undefined') window.addEventListener('offline', this.onlineHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', this.onlineHandler);
        window.removeEventListener('offline', this.onlineHandler);
      }
      this.removeInventoryInputListeners();
      this.pvpSearchTimer?.remove(false);
    });
  }

  finishInventoryPointer(pointer) {
    const drag = this.inventoryDrag;
    const tap = this.inventoryTap;
    this.inventoryDrag = null;
    this.inventoryTap = null;
    const itemId = getInventoryTapItemId(drag, tap, pointer, this.gameState.inventory);
    if (itemId === null) return;
    this.selectedItem = { type:'inventory', id:itemId };
    this.refresh();
  }

  removeInventoryInputListeners() {
    if (!this.inventoryInputHandlers) return;
    removeInventoryInputHandlers(this.input, this.inventoryInputHandlers);
    this.inventoryInputHandlers = null;
    this.inventoryDrag = null;
    this.inventoryTap = null;
  }

  commitState(nextState) {
    if (this.transitioning || this.pvpSearching) return;
    this.gameState = nextState;
    this.saveState(this.gameState);
    this.refresh();
  }

  refresh() {
    this.inventoryScrollRow = clampInventoryScrollRow(
      this.inventoryScrollRow,
      this.gameState.inventory.length,
    );
    this.children.removeAll(true);
    this.renderTown();
  }

  renderTown() {
    const { progression, player, materials, gold, inventory } = this.gameState;
    const stats = derivePlayerStats(this.gameState);
    this.add.rectangle(640, 360, 1280, 720, 0x121a23);
    this.add.text(32, 58, '마창기사 · 마을', { fontFamily:'sans-serif', fontSize:'27px', color:'#f4e6bf' });
    this.add.text(345, 58, progression.chapter + '회차 · 해금 ' + progression.unlockedChapter + '-' + progression.unlockedStage, { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df' });
    this.add.text(700, 58, 'Lv.' + player.level + '  XP ' + player.xp + '/' + player.xpToNext, { fontFamily:'sans-serif', fontSize:'16px', color:'#f4e6bf' });
    this.add.text(700, 83, 'HP ' + player.currentHp + '/' + stats.maxHp + '   ATK ' + stats.attack + '   DEF ' + stats.defense + '   치명타 ' + (stats.critChance * 100).toFixed(1) + '%', { fontFamily:'sans-serif', fontSize:'14px', color:'#b8c7d5' });
    this.add.text(1035, 58, '재료 ' + materials + ' · 골드 ' + gold, { fontFamily:'sans-serif', fontSize:'17px', color:'#ffcf45' });

    this.add.rectangle(640, 128, 1216, 48, 0x1a2531, 0.96).setStrokeStyle(1, 0x47576a);
    this.add.text(44, 109, `미사용 ${player.availableStatPoints} · 배정 ${player.spentStatPoints} · 골드 ${gold}\n공격 ${stats.attack} · 방어 ${stats.defense} · 최대 HP ${stats.maxHp}`, { fontFamily:'sans-serif', fontSize:'12px', color:'#d8e0e8', lineSpacing:3 });
    const allocationButtons = [
      { key:'attack', x:500, width:112, label:'공격 +5' },
      { key:'defense', x:620, width:112, label:'방어 +10' },
      { key:'maxHp', x:740, width:126, label:'최대 HP +30' },
    ];
    allocationButtons.forEach(({ key, x, width, label }) => createButton(this, {
      x, y:108, width, height:40, label,
      enabled:player.availableStatPoints > 0,
      onClick:() => {
        const result = allocateStatPoint(this.gameState, key);
        if (result.ok) this.commitState(result.state);
      },
    }));
    let resetCost = null;
    try { resetCost = getStatResetCost(player.statResetCount); } catch { /* Corrupt or overflowing counts cannot trigger a reset. */ }
    const canReset = player.spentStatPoints > 0 && resetCost !== null && gold >= resetCost;
    const resetLabel = player.spentStatPoints < 1
      ? '초기화할 능력치 없음'
      : resetCost === null
        ? '초기화 비용 범위 초과'
        : gold < resetCost
          ? `골드 부족 · ${resetCost.toLocaleString()} 필요`
          : `초기화 ${resetCost.toLocaleString()}G · 이후 ${ (gold - resetCost).toLocaleString()}G`;
    createButton(this, {
      x:878, y:108, width:354, height:40, label:resetLabel, enabled:canReset,
      onClick:() => {
        const result = resetStatPoints(this.gameState);
        if (result.ok) this.commitState(result.state);
      },
    });

    createPanel(this, { x:32, y:160, width:418, height:450, title:'장착 장비' });
    createPanel(this, { x:465, y:160, width:438, height:450, title:'보관함 ' + inventory.length + '/' + BALANCE.inventoryCapacity });
    createPanel(this, { x:918, y:160, width:330, height:450, title:'장비 정보' });
    this.renderEquipment();
    this.renderInventory();
    this.renderSelectedItem();
    this.renderStagePanel();
  }

  renderEquipment() {
    SLOT_ORDER.forEach((slot, index) => {
      const item = this.gameState.equipment[slot];
      const x = 46;
      const y = 192 + index * 66;
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
    const viewport = { x:470, y:190, width:430, height:410 };
    const grid = this.add.container(0, 0);
    inventory.forEach((item, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2) - this.inventoryScrollRow;
      const x = 478 + column * 204;
      const y = 196 + row * 78;
      if (row < 0 || row >= 5 || y + 74 < viewport.y || y > viewport.y + viewport.height) return;
      const card = this.add.rectangle(x + 96, y + 37, 192, 74, 0x263342);
      card.setStrokeStyle(1, 0x596a7b);
      const label = this.add.text(x + 8, y + 5, SLOT_LABEL[item.slot] + ' · ' + RARITY_LABEL[item.rarity] + ' · Lv.' + item.level, { fontFamily:'sans-serif', fontSize:'13px', color:rarityHex(item.rarity) });
      const stats = this.add.text(x + 8, y + 27, getGearStatSummary(item).map(({key,value}) => STAT_LABEL[key] + ' +' + formatStat(key,value)).join(' / '), { fontFamily:'sans-serif', fontSize:'11px', color:'#e6edf3', wordWrap:{width:176} });
      const select = this.add.rectangle(x + 96, y + 37, 192, 74, 0xffffff, 0);
      select.setInteractive(new Phaser.Geom.Rectangle(0,0,192,74), Phaser.Geom.Rectangle.Contains)
        .on('pointerdown', (pointer) => {
          this.inventoryTap = {
            pointerId: pointer.id,
            itemId: item.id,
            left: x,
            right: x + 192,
            top: y,
            bottom: y + 74,
          };
        });
      grid.add([card, drawRarityFrame(this,x,y,192,74,item.rarity),label,stats,select]);
    });
    this.add.text(596, 608, inventory.length > 10 ? '드래그 또는 마우스 휠로 보관함 스크롤' : '획득 장비는 이곳에 보관됩니다', { fontFamily:'sans-serif', fontSize:'12px', color:'#99a7b4' }).setOrigin(0, 1);
  }

  renderSelectedItem() {
    const selected = this.selectedItem;
    const item = selected
      ? selected.type === 'equipment'
        ? Object.values(this.gameState.equipment).find((candidate) => candidate?.id === selected.id)
        : this.gameState.inventory.find((candidate) => candidate.id === selected.id)
      : null;
    if (!item) {
      const message = this.upgradeFeedback?.itemId === null
        ? this.upgradeFeedback.message
        : '장비를 선택하면\n능력치와 행동을 볼 수 있습니다.';
      this.add.text(944, 202, message, { fontFamily:'sans-serif', fontSize:'16px', color:'#aeb9c4', lineSpacing:8 });
      return;
    }
    this.add.text(940, 198, SLOT_LABEL[item.slot] + ' · ' + RARITY_LABEL[item.rarity] + '\n장비 레벨 ' + item.level + '/' + BALANCE.gearMaxLevel, { fontFamily:'sans-serif', fontSize:'17px', color:'#f4e6bf', lineSpacing:8 });
    let detailY = 252;
    for (const {key,value} of getGearStatSummary(item)) {
      this.add.text(942, detailY, STAT_LABEL[key] + '  +' + formatStat(key,value), { fontFamily:'sans-serif', fontSize:'14px', color:'#d8e0e8' });
      detailY += 25;
    }
    for (const effect of item.effects) {
      this.add.text(942, detailY, (EFFECT_LABEL[effect.id] ?? effect.id) + '  +' + (effect.value * 100).toFixed(1) + '%', { fontFamily:'sans-serif', fontSize:'13px', color:'#d5b2ff' });
      detailY += 23;
    }
    const y = Math.max(378, detailY + 14);
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
    const atMaxLevel = item.level >= BALANCE.gearMaxLevel;
    const hasMaterials = this.gameState.materials >= cost;
    const canUpgrade = !atMaxLevel && hasMaterials;
    const upgradeY = selected.type === 'inventory' ? y + 106 : Math.max(420, detailY + 50);
    if (canUpgrade) {
      const band = getGearUpgradeBand(item.level);
      const percent = (chance) => `${Math.round(chance * 100)}%`;
      this.add.text(943, upgradeY - 48,
        `실패 ${percent(band.failureChance)} · 파괴 ${percent(band.destructionChance)}\n성공 후 대성공 ${percent(BALANCE.gearUpgrade.greatSuccessChance)}`,
        { fontFamily:'sans-serif', fontSize:'11px', color:'#d8e0e8', lineSpacing:2 });
    }
    const upgradeLabel = atMaxLevel
      ? '최대 레벨'
      : !hasMaterials
        ? `재료 부족 · ${cost} 필요`
        : `강화 · 재료 ${cost}`;
    createButton(this, { x:936,y:upgradeY,width:296,height:48,label:upgradeLabel,enabled:canUpgrade,onClick:() => {
      const result=upgradeGear(this.gameState,item.id);
      if (!result.ok) {
        this.upgradeFeedback = null;
        this.refresh();
        return;
      }
      const messages = {
        failed:'강화 실패 · 장비는 유지됩니다.',
        destroyed:'강화 파괴 · 장비가 사라졌습니다.',
        success:result.greatSuccess ? '강화 대성공!' : '강화 성공.',
      };
      this.upgradeFeedback = {
        itemId:result.outcome === 'destroyed' ? null : item.id,
        message:messages[result.outcome],
      };
      this.selectedItem = result.outcome === 'destroyed' ? null : { ...selected };
      this.commitState(result.state);
    }});
    this.add.text(943, upgradeY + 53, '일반 능력치는 구간별 · 특수 능력은 종류별 고정 범위\n대성공 시 해당 증가량 2배', { fontFamily:'sans-serif', fontSize:'10px', color:'#9eacba', wordWrap:{width:286}, lineSpacing:2 });
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
    createButton(this,{x:32,y:630,width:188,height:58,label:'◀ 이전',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex-1+options.length)%options.length];this.refresh();
    }});
    this.add.text(230, 635, (isReplay?'반복 · XP '+Math.round(this.replayXpMultiplier*100)+'%':'신규 도전')+'\n'+stageName(this.selectedStageId), { fontFamily:'sans-serif',fontSize:'14px',color:'#f4e6bf',lineSpacing:3 });
    createButton(this,{x:560,y:630,width:190,height:58,label:'다음 ▶',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex+1)%options.length];this.refresh();
    }});
    createButton(this,{x:770,y:630,width:220,height:58,label:'전투 출발',onClick:()=>this.startBattle(this.selectedStageId)});
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    createButton(this,{x:1010,y:630,width:238,height:58,label:this.pvpSearching?'상대 찾는 중...':'비동기 PvP',enabled:!this.pvpSearching && online && Boolean(this.pvpClient),onClick:()=>this.startPvp()});
  }

  showPvpNotice({ title, message, actions = [] }) {
    this.refresh();
    const overlay = this.add.container(0, 0).setDepth(300);
    this.pvpOverlay = overlay;
    overlay.add(this.add.rectangle(640, 360, 540, 260, 0x090e14, 0.94).setStrokeStyle(2, 0xd8ba77));
    overlay.add(this.add.text(640, 278, title, { fontFamily:'sans-serif', fontSize:'25px', color:'#f4e6bf' }).setOrigin(0.5));
    overlay.add(this.add.text(640, 330, message, { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df', align:'center', wordWrap:{ width:470 }, lineSpacing:7 }).setOrigin(0.5));
    const buttonWidth = Math.min(190, 420 / Math.max(1, actions.length));
    const totalWidth = buttonWidth * actions.length + Math.max(0, actions.length - 1) * 12;
    actions.forEach((action, index) => {
      const x = 640 - totalWidth / 2 + buttonWidth / 2 + index * (buttonWidth + 12);
      const button = this.add.rectangle(x, 430, buttonWidth, 48, 0x344659).setStrokeStyle(1, 0xd8ba77);
      const label = this.add.text(x, 430, action.label, { fontFamily:'sans-serif', fontSize:'15px', color:'#fff3d5' }).setOrigin(0.5);
      button.setInteractive({ useHandCursor:true }).on('pointerdown', () => action.onClick());
      label.setInteractive({ useHandCursor:true }).on('pointerdown', () => action.onClick());
      overlay.add([button, label]);
    });
  }

  async startPvp() {
    if (this.transitioning || this.pvpSearching || !this.pvpClient) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.showPvpNotice({ title:'인터넷 연결 필요', message:'비동기 PvP는 온라인에서만 입장할 수 있습니다.', actions:[{ label:'확인', onClick:()=>this.refresh() }] });
      return;
    }
    this.transitioning = true;
    this.pvpSearching = true;
    this.refresh();
    const startedAt = Date.now();
    const updateSearchText = () => {
      if (!this.pvpSearching || !this.pvpSearchLabel?.active) return;
      const elapsed = Math.min(60, Math.floor((Date.now() - startedAt) / 1000));
      this.pvpSearchLabel.setText(`상대를 찾는 중... ${elapsed}/60초\n점수 범위 ±100부터 5초마다 넓혀 최대 ±500까지 검색합니다.`);
    };
    const overlay = this.add.container(0, 0).setDepth(300);
    this.pvpOverlay = overlay;
    overlay.add(this.add.rectangle(640, 360, 540, 220, 0x090e14, 0.94).setStrokeStyle(2, 0xd8ba77));
    overlay.add(this.add.text(640, 286, 'PvP 상대 검색', { fontFamily:'sans-serif', fontSize:'25px', color:'#f4e6bf' }).setOrigin(0.5));
    this.pvpSearchLabel = this.add.text(640, 360, '', { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df', align:'center', wordWrap:{ width:470 }, lineSpacing:7 }).setOrigin(0.5);
    overlay.add(this.pvpSearchLabel);
    updateSearchText();
    this.pvpSearchTimer = this.time.addEvent({ delay:500, loop:true, callback:updateSearchText });
    let response;
    try { response = await this.pvpClient.findMatch(); }
    catch (error) { response = { ok:false, reason:error?.message === 'authentication-required' ? 'authentication-required' : 'network-unavailable' }; }
    this.pvpSearchTimer?.remove(false);
    this.pvpSearchTimer = null;
    this.pvpSearching = false;
    this.pvpOverlay?.destroy(true);
    this.pvpOverlay = null;
    if (response?.ok && response.ticket) {
      this.scene.start('PvpScene', {
        ticket:response.ticket,
        gameState:this.gameState,
        saveState:this.saveState,
        pvpClient:this.pvpClient,
        rankingClient:this.rankingClient,
        rankedRunClient:this.rankedRunClient,
      });
      return;
    }
    this.transitioning = false;
    const reason = response?.reason ?? 'network-unavailable';
    if (reason === 'no-opponent') {
      this.showPvpNotice({
        title:'상대를 찾지 못했습니다',
        message:'60초 동안 범위를 넓혀 검색했지만 상대가 없었습니다. 검색 범위는 ±100점부터 시작해 ±500점까지 확장됩니다.',
        actions:[
          { label:'다시 검색', onClick:()=>{ this.pvpOverlay?.destroy(true); this.pvpOverlay=null; void this.startPvp(); } },
          { label:'마을로', onClick:()=>this.refresh() },
        ],
      });
    } else if (reason === 'authentication-required') {
      this.showPvpNotice({ title:'회사 계정 인증 필요', message:'계정 인증을 다시 완료해야 PvP를 시작할 수 있습니다.', actions:[
        { label:'다시 인증', onClick:async()=>{
          const auth = await this.pvpClient.retryAuthentication();
          this.pvpOverlay?.destroy(true); this.pvpOverlay=null;
          if (auth?.ok !== false) void this.startPvp(); else this.showPvpNotice({ title:'인증 실패', message:'인증을 완료하지 못했습니다.', actions:[{label:'마을로',onClick:()=>this.refresh()}] });
        } },
        { label:'마을로', onClick:()=>this.refresh() },
      ] });
    } else {
      const message = reason === 'offline' ? '인터넷에 연결한 뒤 다시 시도해 주세요.' : '저장 또는 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
      this.showPvpNotice({ title:'PvP를 시작하지 못했습니다', message, actions:[{ label:'확인', onClick:()=>this.refresh() }] });
    }
  }

  async startBattle(selectedStageId) {
    if (this.transitioning || this.pvpSearching) return;
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
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
      rankedTicket:ranked.ranked ? ranked.ticket : null,
      rankedReason:ranked.reason,
      chapter,
      stage,
      isReplay,
      stageSnapshot,
    });
  }
}
