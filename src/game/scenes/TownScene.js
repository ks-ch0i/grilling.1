import Phaser from 'phaser';
import { BALANCE, GEAR_SLOT, RARITY_COLOR, getGearUpgradeBand } from '../data/balance.js';
import { createInitialState, equipGear, dismantleGear, derivePlayerStats, getGearStatSummary, getGearUpgradeCost } from '../domain/gear.js';
import { allocateStatPoint, getStatResetCost, stageId } from '../domain/progression.js';
import { installEquippedProfileItem, previewProfileSpend, runProfileSpendPreview } from '../domain/profileActionClient.js';
import { createProfileActionRequestExecutor } from '../domain/profileActionRequest.js';
import { createButton, createPanel, drawRarityFrame } from '../ui/components.js';
import { createKeyboardNavigation } from '../ui/keyboardNavigation.js';
import { formatPvpHistoryRow, isCurrentPvpHistoryRequest } from '../ui/pvpHistory.js';
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
    const bootstrap = this.game?.lancerBootstrap;
    this.applyProfileAction = bootstrap?.applyProfileAction;
    this.getSaveMode = bootstrap?.getSaveMode;
    this.profileActionExecutor = createProfileActionRequestExecutor({ applyProfileAction:this.applyProfileAction });
    this.hasUnverifiedShadow = bootstrap?.hasUnverifiedShadow;
    this.selectLocalShadow = bootstrap?.selectLocalShadow;
    this.recoverLegacySave = bootstrap?.recoverLegacySave;
    this.profileActionPending = false;
    this.profileActionMessage = null;
    this.rankedRunClient = data.rankedRunClient;
    this.pvpClient = data.pvpClient;
    this.rankingClient = data.rankingClient;
    this.pvpSearching = false;
    this.historyPage = 1;
    this.historyRequestId = 0;
    this.pvpHistoryOverlay = null;
    this.pvpHistoryState = null;
    this.selectedStageId = data.unlockedStageId ?? stageId(
      this.gameState.progression.chapter,
      this.gameState.progression.currentStage,
    );
    this.replayXpMultiplier = data.replayXpMultiplier ?? BALANCE.replayXpMultiplier;
  }

  create() {
    this.rankingMarquee = new RankingMarquee(this, this.rankingClient);
    this.keyboardNavigation = createKeyboardNavigation(this);
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
    this.onlineHandler = () => {
      if (this.pvpHistoryOverlay) {
        if (this.pvpHistoryState?.kind === 'error' && typeof navigator !== 'undefined' && navigator.onLine !== false) {
          void this.loadPvpHistoryPage(this.historyPage);
        }
        return;
      }
      this.refresh();
    };
    if (typeof window !== 'undefined') window.addEventListener('online', this.onlineHandler);
    if (typeof window !== 'undefined') window.addEventListener('offline', this.onlineHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', this.onlineHandler);
        window.removeEventListener('offline', this.onlineHandler);
      }
      this.removeInventoryInputListeners();
      this.keyboardNavigation?.destroy();
      this.keyboardNavigation = null;
      this.pvpSearchTimer?.remove(false);
      this.historyRequestId += 1;
      this.pvpHistoryOverlay?.destroy(true);
      this.pvpHistoryOverlay = null;
    });
  }

  finishInventoryPointer(pointer) {
    const drag = this.inventoryDrag;
    const tap = this.inventoryTap;
    this.inventoryDrag = null;
    this.inventoryTap = null;
    const itemId = getInventoryTapItemId(drag, tap, pointer, this.gameState.inventory);
    if (itemId === null) return;
    this.selectInventoryItem(itemId);
  }

  selectInventoryItem(itemId) {
    if (!this.gameState.inventory.some((item) => item.id === itemId)) return;
    this.selectedItem = { type:'inventory', id:itemId };
    this.refresh();
  }

  selectEquipmentItem(itemId) {
    const item = Object.values(this.gameState.equipment).find((candidate) => candidate?.id === itemId);
    this.selectedItem = item ? { type:'equipment', id:item.id } : null;
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

  hasAuthoritativeProfile() {
    return typeof this.applyProfileAction === 'function' && this.getSaveMode?.() === 'verified-online';
  }

  async activateLocalSave() {
    if (typeof this.selectLocalShadow !== 'function') return;
    const selected = await this.selectLocalShadow('town-local-save-selected', { preferExisting:true });
    if (!selected?.ok || !selected.state) {
      this.profileActionMessage = '기기 저장을 선택하지 못했습니다. 저장 공간을 확인해 주세요.';
      this.refresh();
      return;
    }
    this.gameState = selected.state;
    this.profileActionMessage = '기기 저장을 선택했습니다. 이 진행은 온라인 보상과 합쳐지지 않습니다.';
    this.refresh();
  }

  confirmLegacyRecovery(hasShadow) {
    this.showPvpNotice({
      title:'이전 저장 복구',
      message:hasShadow
        ? '이전 저장을 적용하면 현재 기기 진행은 복구용으로 보관되고, 이 기기에서 플레이하는 저장이 바뀝니다.'
        : '이전 저장을 확인합니다. 복구한 진행은 이 기기에서만 플레이되며 온라인 저장과 합쳐지지 않습니다.',
      actions:[
        { label:'복구', onClick:() => { void this.applyLegacyRecovery(hasShadow); } },
        { label:'취소', onClick:() => { this.pvpOverlay?.destroy(true); this.pvpOverlay=null; this.refresh(); } },
      ],
    });
  }

  async applyLegacyRecovery(replaceShadow) {
    this.pvpOverlay?.destroy(true);
    this.pvpOverlay = null;
    const recovered = await this.recoverLegacySave({ replaceShadow });
    if (!recovered?.ok || !recovered.state) {
      this.profileActionMessage = recovered?.error === 'legacy-save-not-found' || recovered?.error === 'legacy-recovery-unavailable'
        ? '복구할 수 있는 이전 저장이 없습니다.'
        : '이전 저장을 복구하지 못했습니다. 현재 저장은 유지됩니다.';
      this.refresh();
      return;
    }
    this.gameState = recovered.state;
    this.profileActionMessage = '이전 저장을 복구했습니다. 현재 기기 진행은 복구용으로 보관했습니다.';
    this.refresh();
  }

  async requestProfileAction(action) {
    if (this.profileActionPending || typeof this.applyProfileAction !== 'function') {
      return { ok:false, error:'profile-actions-unavailable' };
    }
    this.profileActionPending = true;
    this.refresh();
    let result;
    try {
      result = await this.profileActionExecutor(action);
      if (result?.state) this.gameState = result.state;
      if (!result?.ok) {
        const messages = {
          'insufficient-gold':'서버 골드가 부족합니다. 저장을 새로고침했습니다.',
          'insufficient-materials':'서버 재료가 부족합니다. 저장을 새로고침했습니다.',
          'inventory-item-not-found':'장비를 서버 보관함에서 찾을 수 없습니다. 저장을 새로고침했습니다.',
          'save-revision-conflict':'저장 상태가 바뀌었습니다. 최신 저장을 적용했습니다.',
          'equipment-changed':'장비 상태가 바뀌었습니다. 최신 저장을 적용했습니다. 다시 선택해 주세요.',
          'network-unavailable':'서버에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
          'authentication-required':'인증이 만료되었습니다. 다시 로그인해 주세요.',
        };
        this.profileActionMessage = messages[result?.error] ?? '서버 명령을 적용하지 못했습니다.';
      } else {
        this.profileActionMessage = null;
      }
    } catch {
      result = { ok:false, error:'network-unavailable' };
      this.profileActionMessage = '서버에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
    } finally {
      this.profileActionPending = false;
      if (!result?.ok) this.refresh();
    }
    return result;
  }

  refresh() {
    this.keyboardNavigation?.reset();
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
    if (this.profileActionMessage) {
      this.add.text(32, 696, this.profileActionMessage, { fontFamily:'sans-serif', fontSize:'12px', color:'#ffb6ad' });
    }
    this.add.rectangle(640, 128, 1216, 48, 0x1a2531, 0.96).setStrokeStyle(1, 0x47576a);
    this.add.text(44, 109, `미사용 ${player.availableStatPoints} · 배정 ${player.spentStatPoints} · 골드 ${gold}\n공격 ${stats.attack} · 방어 ${stats.defense} · 최대 HP ${stats.maxHp}`, { fontFamily:'sans-serif', fontSize:'12px', color:'#d8e0e8', lineSpacing:3 });
    const allocationButtons = [
      { key:'attack', x:500, width:112, label:'공격 +5' },
      { key:'defense', x:620, width:112, label:'방어 +10' },
      { key:'maxHp', x:740, width:126, label:'최대 HP +30' },
    ];
    allocationButtons.forEach(({ key, x, width, label }) => createButton(this, {
      x, y:108, width, height:40, label,
      enabled:player.availableStatPoints > 0 && !this.profileActionPending,
      onClick:() => {
        const result = allocateStatPoint(this.gameState, key);
        if (result.ok) this.commitState(result.state);
      },
    }));
    let resetCost = null;
    try { resetCost = getStatResetCost(player.statResetCount); } catch { /* Corrupt or overflowing counts cannot trigger a reset. */ }
    const canReset = player.spentStatPoints > 0 && resetCost !== null && gold >= resetCost && !this.profileActionPending;
    const resetLabel = player.spentStatPoints < 1
      ? '초기화할 능력치 없음'
      : resetCost === null
        ? '초기화 비용 범위 초과'
        : gold < resetCost
          ? `골드 부족 · ${resetCost.toLocaleString()} 필요`
          : `초기화 ${resetCost.toLocaleString()}G · 이후 ${ (gold - resetCost).toLocaleString()}G`;
    createButton(this, {
      x:878, y:108, width:354, height:40, label:resetLabel, enabled:canReset,
      onClick:async () => {
        if (this.hasAuthoritativeProfile()) {
          const result = await runProfileSpendPreview(
            this.gameState,
            { type:'reset-stat-points' },
            (action) => this.requestProfileAction(action),
            { serverProfile:true },
          );
          if (result.ok) this.commitState(result.state);
          return;
        }
        const preview = previewProfileSpend(this.gameState, { type:'reset-stat-points' });
        if (preview.ok) this.commitState(preview.state);
      },
    });

    createPanel(this, { x:32, y:160, width:418, height:450, title:'장착 장비' });
    createPanel(this, { x:465, y:160, width:438, height:450, title:'보관함 ' + inventory.length + '/' + BALANCE.inventoryCapacity });
    createPanel(this, { x:918, y:160, width:330, height:450, title:'장비 정보' });
    this.renderEquipment();
    this.renderInventory();
    this.renderSelectedItem();
    this.renderStagePanel();
    const hasShadow = Boolean(this.hasUnverifiedShadow?.());
    if (hasShadow && typeof this.selectLocalShadow === 'function') {
      createButton(this, {
        x:918, y:620, width:158, height:36, label:'기기 진행 선택',
        onClick:() => { void this.activateLocalSave(); },
      });
    }
    if (typeof this.recoverLegacySave === 'function') {
      createButton(this, {
        x:1082, y:620, width:166, height:36, label:'이전 저장 확인',
        onClick:() => this.confirmLegacyRecovery(hasShadow),
      });
    }
  }

  renderEquipment() {
    SLOT_ORDER.forEach((slot, index) => {
      const item = this.gameState.equipment[slot];
      const x = 46;
      const y = 192 + index * 66;
      const card = this.add.rectangle(x + 194, y + 29, 388, 64, 0x263342);
      card.setStrokeStyle(1, 0x56687a);
      let rarityFrame = null;
      this.add.text(x + 12, y + 7, SLOT_LABEL[slot] + ' · ' + (item ? RARITY_LABEL[item.rarity] : '비어 있음'), { fontFamily:'sans-serif', fontSize:'15px', color:item ? rarityHex(item.rarity) : '#9ba7b3' });
      if (item) {
        this.add.text(x + 12, y + 33, 'Lv.' + item.level + '  ' + getGearStatSummary(item).map(({key,value}) => STAT_LABEL[key] + ' +' + formatStat(key,value)).join('  '), { fontFamily:'sans-serif', fontSize:'12px', color:'#e6edf3' });
        rarityFrame = drawRarityFrame(this, x + 1, y - 2, 386, 62, item.rarity);
      }
      const selectEquipment = () => this.selectEquipmentItem(item?.id);
      card.setInteractive(new Phaser.Geom.Rectangle(0,0,388,64), Phaser.Geom.Rectangle.Contains).on('pointerdown', selectEquipment);
      this.keyboardNavigation?.register(card, {
        activate: selectEquipment,
        focus: () => {
          card.setStrokeStyle(3, 0xffd166);
          rarityFrame?.setStrokeStyle(3, 0xffd166);
        },
        blur: () => {
          card.setStrokeStyle(1, 0x56687a);
          if (rarityFrame) rarityFrame.setStrokeStyle(2, RARITY_COLOR[item.rarity] ?? RARITY_COLOR.common);
        },
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
      const rarityFrame = drawRarityFrame(this,x,y,192,74,item.rarity);
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
      const selectInventoryItem = () => this.selectInventoryItem(item.id);
      this.keyboardNavigation?.register(select, {
        activate: selectInventoryItem,
        focus: () => rarityFrame.setStrokeStyle(3, 0xffd166),
        blur: () => rarityFrame.setStrokeStyle(2, RARITY_COLOR[item.rarity] ?? RARITY_COLOR.common),
      });
      grid.add([card, rarityFrame,label,stats,select]);
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
      const canEquip = (!oldItem || this.gameState.inventory.length < BALANCE.inventoryCapacity) && !this.profileActionPending;
      createButton(this, { x:936,y,width:138,height:48,label:'장착',enabled:canEquip,onClick:async () => {
        if (this.hasAuthoritativeProfile()) {
          const preview = equipGear(this.gameState, item.id);
          if (!preview.ok) return;
          const result = await this.requestProfileAction({
            type:'equip-inventory-item',
            itemId:item.id,
            expectedEquippedItemId:oldItem?.id ?? null,
          });
          if (result.ok && result.consumedItem) {
            const nextState = installEquippedProfileItem(result.state, result.consumedItem);
            this.selectedItem = { type:'equipment', id:result.consumedItem.id };
            this.commitState(nextState);
          }
          return;
        }
        const result = equipGear(this.gameState, item.id);
        if (result.ok) { this.selectedItem={type:'equipment',id:item.id}; this.commitState(result.state); }
      }});
      createButton(this, { x:1084,y,width:148,height:48,label:'분해',enabled:!this.profileActionPending,onClick:async () => {
        if (this.hasAuthoritativeProfile()) {
          const result = await this.requestProfileAction({ type:'dismantle-inventory-item', itemId:item.id });
          if (result.ok) { this.selectedItem=null; this.commitState(result.state); }
          return;
        }
        const result = dismantleGear(this.gameState, item.id);
        if (result.ok) { this.selectedItem=null; this.commitState(result.state); }
      }});
    }
    const cost = getGearUpgradeCost(item.level);
    const atMaxLevel = item.level >= BALANCE.gearMaxLevel;
    const hasMaterials = this.gameState.materials >= cost;
    const serverProfile = this.hasAuthoritativeProfile();
    const inventoryUpgradeBlocked = serverProfile && selected.type === 'inventory';
    const canUpgrade = !atMaxLevel && hasMaterials && !inventoryUpgradeBlocked && !this.profileActionPending;
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
      : inventoryUpgradeBlocked
        ? '장착 후 강화'
        : !hasMaterials
        ? `재료 부족 · ${cost} 필요`
        : `강화 · 재료 ${cost}`;
    createButton(this, { x:936,y:upgradeY,width:296,height:48,label:upgradeLabel,enabled:canUpgrade,onClick:async () => {
      let result;
      if (this.hasAuthoritativeProfile()) {
        result = await runProfileSpendPreview(
          this.gameState,
          { type:'upgrade-gear', itemId:item.id },
          (action) => this.requestProfileAction(action),
          { serverProfile:true },
        );
      } else {
        const preview = previewProfileSpend(this.gameState, { type:'upgrade-gear', itemId:item.id });
        result = preview.ok ? { ...preview, state:preview.state } : preview;
      }
      if (!result.ok) return;
      const upgrade = result.preview?.preview ?? result.preview;
      const messages = {
        failed:'강화 실패 · 장비는 유지됩니다.',
        destroyed:'강화 파괴 · 장비가 사라졌습니다.',
        success:upgrade?.greatSuccess ? '강화 대성공!' : '강화 성공.',
      };
      this.upgradeFeedback = {
        itemId:upgrade?.outcome === 'destroyed' ? null : item.id,
        message:messages[upgrade?.outcome],
      };
      this.selectedItem = upgrade?.outcome === 'destroyed' ? null : { ...selected };
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
    createButton(this,{x:32,y:630,width:150,height:58,label:'◀ 이전',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex-1+options.length)%options.length];this.refresh();
    }});
    this.add.text(190, 635, (isReplay?'반복 · XP '+Math.round(this.replayXpMultiplier*100)+'%':'신규 도전')+'\n'+stageName(this.selectedStageId), { fontFamily:'sans-serif',fontSize:'14px',color:'#f4e6bf',lineSpacing:3,wordWrap:{width:245} });
    createButton(this,{x:445,y:630,width:150,height:58,label:'다음 ▶',enabled:options.length>1,onClick:()=>{
      this.selectedStageId=options[(selectedIndex+1)%options.length];this.refresh();
    }});
    createButton(this,{x:610,y:630,width:190,height:58,label:'전투 출발',onClick:()=>this.startBattle(this.selectedStageId)});
    createButton(this,{x:815,y:630,width:180,height:58,label:'PvP 기록',enabled:!this.pvpSearching && Boolean(this.pvpClient),onClick:()=>this.openPvpHistory()});
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    createButton(this,{x:1010,y:630,width:238,height:58,label:this.pvpSearching?'상대 찾는 중...':'비동기 PvP',enabled:!this.pvpSearching && online && Boolean(this.pvpClient),onClick:()=>this.startPvp()});
  }

  async openPvpHistory() {
    if (this.transitioning || this.pvpSearching || !this.pvpClient || this.pvpHistoryOverlay) return;
    this.historyPage = 1;
    this.pvpHistoryState = { kind:'loading', page:1 };
    this.refresh();
    this.keyboardNavigation?.reset();
    await this.loadPvpHistoryPage(1);
  }

  async loadPvpHistoryPage(page) {
    const requestId = ++this.historyRequestId;
    this.historyPage = page;
    this.pvpHistoryState = { kind:'loading', page };
    this.renderPvpHistory();
    let result;
    try {
      result = await this.pvpClient?.getMatchHistory(page);
    } catch {
      result = { ok:false, reason:'network-unavailable' };
    }
    if (!isCurrentPvpHistoryRequest(requestId, this.historyRequestId, Boolean(this.pvpHistoryOverlay))) return;
    this.pvpHistoryState = result?.ok
      ? { kind:'ready', ...result }
      : { kind:'error', page, reason:result?.reason ?? 'network-unavailable' };
    this.renderPvpHistory();
  }

  closePvpHistory() {
    this.historyRequestId += 1;
    this.pvpHistoryState = null;
    this.pvpHistoryOverlay?.destroy(true);
    this.pvpHistoryOverlay = null;
    this.refresh();
  }

  renderPvpHistory() {
    this.keyboardNavigation?.reset();
    this.pvpHistoryOverlay?.destroy(true);
    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(400);
    this.pvpHistoryOverlay = overlay;
    const backdrop = this.add.rectangle(640, 360, 1280, 720, 0x05080c, 0.78).setInteractive();
    backdrop.on('pointerdown', () => {});
    overlay.add(backdrop);
    overlay.add(this.add.rectangle(640, 360, 1000, 580, 0x111a24, 1).setStrokeStyle(2, 0xd8ba77));
    overlay.add(this.add.text(640, 98, 'PvP 경기 기록', { fontFamily:'sans-serif', fontSize:'25px', color:'#f4e6bf' }).setOrigin(0.5));
    const closeButton = createButton(this, {
      x:1040, y:78, width:72, height:40, label:'닫기',
      onClick:() => this.closePvpHistory(),
    });
    overlay.add(closeButton);

    const state = this.pvpHistoryState ?? { kind:'loading', page:this.historyPage };
    if (state.kind === 'loading') {
      overlay.add(this.add.text(640, 350, '경기 기록을 불러오는 중...', { fontFamily:'sans-serif', fontSize:'17px', color:'#cad4df' }).setOrigin(0.5));
      return;
    }
    if (state.kind === 'error') {
      const message = state.reason === 'authentication-required'
        ? '회사 계정 인증을 확인한 뒤 다시 시도해 주세요.'
        : '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
      overlay.add(this.add.text(640, 330, message, { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df', align:'center', wordWrap:{ width:650 } }).setOrigin(0.5));
      const retryButton = createButton(this, {
        x:565, y:408, width:150, height:48, label:'다시 시도',
        onClick:() => { void this.loadPvpHistoryPage(state.page); },
      });
      overlay.add(retryButton);
      return;
    }
    if (state.items.length === 0) {
      overlay.add(this.add.text(640, 350, '아직 완료된 PvP 경기 기록이 없습니다.', { fontFamily:'sans-serif', fontSize:'17px', color:'#cad4df' }).setOrigin(0.5));
    } else {
      overlay.add(this.add.text(200, 145, '날짜', { fontFamily:'sans-serif', fontSize:'13px', color:'#9eacba' }));
      overlay.add(this.add.text(435, 145, '상대', { fontFamily:'sans-serif', fontSize:'13px', color:'#9eacba' }));
      overlay.add(this.add.text(740, 145, '결과', { fontFamily:'sans-serif', fontSize:'13px', color:'#9eacba' }));
      overlay.add(this.add.text(880, 145, '내 레이팅 변동', { fontFamily:'sans-serif', fontSize:'13px', color:'#9eacba' }));
      state.items.forEach((item, index) => {
        const row = formatPvpHistoryRow(item);
        const y = 178 + index * 36;
        overlay.add(this.add.rectangle(640, y, 930, 32, index % 2 === 0 ? 0x1a2531 : 0x16212c, 1));
        overlay.add(this.add.text(200, y, row.completedAt, { fontFamily:'sans-serif', fontSize:'13px', color:'#cad4df' }).setOrigin(0, 0.5));
        overlay.add(this.add.text(435, y, row.opponent, { fontFamily:'sans-serif', fontSize:'14px', color:'#f4e6bf', wordWrap:{ width:270 } }).setOrigin(0, 0.5));
        overlay.add(this.add.text(740, y, row.outcome, { fontFamily:'sans-serif', fontSize:'14px', color:item.outcome === 'win' ? '#83d694' : item.outcome === 'loss' ? '#ff8d86' : '#d7c5ff' }).setOrigin(0, 0.5));
        overlay.add(this.add.text(880, y, row.rating, { fontFamily:'sans-serif', fontSize:'14px', color:item.rated ? '#cad4df' : '#9eacba' }).setOrigin(0, 0.5));
      });
    }
    const previousButton = createButton(this, {
      x:465, y:574, width:145, height:46, label:'◀ 이전', enabled:state.hasPrevious,
      onClick:() => { void this.loadPvpHistoryPage(state.page - 1); },
    });
    const nextButton = createButton(this, {
      x:670, y:574, width:145, height:46, label:'다음 ▶', enabled:state.hasNext,
      onClick:() => { void this.loadPvpHistoryPage(state.page + 1); },
    });
    overlay.add([previousButton, nextButton]);
    overlay.add(this.add.text(640, 597, `${state.page} 페이지`, { fontFamily:'sans-serif', fontSize:'13px', color:'#cad4df' }).setOrigin(0.5));
  }

  showPvpNotice({ title, message, actions = [] }) {
    this.refresh();
    this.keyboardNavigation?.reset();
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
      this.keyboardNavigation?.register(button, {
        activate: action.onClick,
        focus: () => button.setStrokeStyle(3, 0xffd166),
        blur: () => button.setStrokeStyle(1, 0xd8ba77),
      });
      overlay.add([button, label]);
    });
  }

  async startPvp() {
    if (this.transitioning || this.pvpSearching || !this.pvpClient) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.showPvpNotice({ title:'인터넷 연결 필요', message:'비동기 PvP는 온라인에서만 입장할 수 있습니다.', actions:[{ label:'확인', onClick:()=>this.refresh() }] });
      return;
    }
    const searchHandle = this.pvpClient.createMatchSearch();
    this.transitioning = true;
    this.pvpSearching = true;
    this.refresh();
    this.keyboardNavigation?.reset();
    const startedAt = Date.now();
    const updateSearchText = () => {
      if (!this.pvpSearching || !this.pvpSearchLabel?.active) return;
      const elapsed = Math.min(60, Math.floor((Date.now() - startedAt) / 1000));
      this.pvpSearchLabel.setText(`상대를 찾는 중... ${elapsed}/60초\n점수 범위 ±100부터 5초마다 넓혀 최대 ±500까지 검색합니다.`);
    };
    const overlay = this.add.container(0, 0).setDepth(300);
    this.pvpOverlay = overlay;
    const backdrop = this.add.rectangle(640, 360, 1280, 720, 0x05080c, 0.72).setInteractive();
    backdrop.on('pointerdown', () => {});
    overlay.add(backdrop);
    overlay.add(this.add.rectangle(640, 360, 540, 260, 0x090e14, 0.96).setStrokeStyle(2, 0xd8ba77));
    overlay.add(this.add.text(640, 286, 'PvP 상대 검색', { fontFamily:'sans-serif', fontSize:'25px', color:'#f4e6bf' }).setOrigin(0.5));
    this.pvpSearchLabel = this.add.text(640, 360, '', { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df', align:'center', wordWrap:{ width:470 }, lineSpacing:7 }).setOrigin(0.5);
    overlay.add(this.pvpSearchLabel);
    let cancelPending = false;
    const cancelButton = createButton(this, {
      x:565, y:452, width:150, height:46, label:'검색 취소',
      onClick:() => {
        if (cancelPending) return;
        cancelPending = true;
        this.keyboardNavigation?.reset();
        const label = cancelButton.list?.[1];
        label?.setText('취소 확인 중...');
        cancelButton.disableInteractive();
        cancelButton.setAlpha(0.55);
        void searchHandle.cancel().catch(() => {});
      },
    });
    overlay.add(cancelButton);
    updateSearchText();
    this.pvpSearchTimer = this.time.addEvent({ delay:500, loop:true, callback:updateSearchText });
    let response;
    try { response = await searchHandle.completion; }
    catch (error) { response = { ok:false, reason:error?.message === 'authentication-required' ? 'authentication-required' : 'network-unavailable' }; }
    this.pvpSearchTimer?.remove(false);
    this.pvpSearchTimer = null;
    this.pvpSearching = false;
    this.pvpOverlay?.destroy(true);
    this.pvpOverlay = null;
    if (response?.ok && response.ticket) {
      this.scene.start('PvpScene', {
        ticket:response.ticket,
        searchId:searchHandle.searchId,
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
    if (reason === 'cancelled') {
      this.refresh();
      return;
    }
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
