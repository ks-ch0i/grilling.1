import Phaser from 'phaser';
import { BALANCE, RARITY_COLOR } from '../data/balance.js';
import { resolveContact } from '../domain/combat.js';
import { createInitialState, derivePlayerStats, rollGear, tryStoreDrop } from '../domain/gear.js';
import { completeStage, createGoldRoom, getStageEnemyStats, getStageGoldRequirement, grantGold, grantXp, resetInvalidGoldBalance, resolveLevelUp, retryStage } from '../domain/progression.js';
import { createRankedRun, stepRankedRun } from '@knight-run/game-rules/simulation';
import { createFixedStepAccumulator, createRunInputRecorder } from '../domain/rankedRunClient.js';
import { createButton } from '../ui/components.js';
import { KNIGHT_ANIMATIONS, selectKnightAnimation, selectKnightFacing } from '../ui/knightAnimations.js';
import { RankingMarquee } from '../ui/RankingMarquee.js';

const WORLD_WIDTH = 11200;
const FLOOR_Y = 560;
const PLAYER_WIDTH = 64;
const ENEMY_WIDTH = 70;

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
    this.goldRewardFailureShown = false;
    this.goldFailureBeforeCombat = false;
    this.stageGoldRequirement = 0;
    this.normalEnemyCountOverride = Number.isSafeInteger(data.normalEnemyCountOverride) &&
      data.normalEnemyCountOverride >= BALANCE.normalEnemyCount.min &&
      data.normalEnemyCountOverride <= BALANCE.normalEnemyCount.max
      ? data.normalEnemyCountOverride
      : null;
    this.saveState = typeof data.saveState === 'function' ? data.saveState : () => {};
    this.stageSnapshot = data.stageSnapshot ?? this.gameState;
    this.rankedRunClient = data.rankedRunClient;
    this.pvpClient = data.pvpClient;
    this.rankingClient = data.rankingClient;
    this.rankedTicket = data.rankedTicket ?? null;
    this.rankedReason = data.rankedReason ?? 'ranking-unavailable';
    this.rankedEligible = Boolean(this.rankedTicket && this.rankedRunClient);
    this.rankedRunState = null;
    this.rankedRecorder = createRunInputRecorder();
    this.rankedAccumulator = createFixedStepAccumulator();
    this.rankedQueuedInputs = [];
    this.rankedDiagnostics = { discardedCatchUpSteps: 0 };
    this.normalDefeated = 0;
    this.contactPairs = new Set();
    this.groundDrops = [];
    this.enemies = [];
    this.finished = false;
    this.combatPaused = false;
    this.gameOverOverlayShown = false;
  }

  create() {
    this.initializeRankedRun();
    this.createKnightAnimations();
    this.rankingMarquee = new RankingMarquee(this, this.rankingClient);
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
    this.checkStageGoldCapacity();
    this.resizeHandler = () => this.updatePortraitState();
    this.scale.on('resize', this.resizeHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.resizeHandler));
    this.offlineHandler = () => this.markRankedUnavailable('network-unavailable');
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.offlineHandler);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('offline', this.offlineHandler));
    }
    if (this.rankedTicket && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.markRankedUnavailable('network-unavailable');
    }
  }

  initializeRankedRun() {
    if (!this.rankedTicket) return;
    try {
      if (!Number.isFinite(Date.parse(this.rankedTicket.expiresAtUtc)) || Date.parse(this.rankedTicket.expiresAtUtc) <= Date.now()) {
        this.rankedEligible = false;
        this.rankedReason = 'run-expired';
      }
      this.rankedRunState = createRankedRun(this.rankedTicket, this.rankedTicket.playerSnapshot);
      this.gameState = {
        ...this.gameState,
        player: { ...this.gameState.player, currentHp: this.rankedRunState.player.currentHp },
      };
    } catch {
      this.rankedRunState = null;
      this.rankedEligible = false;
      this.rankedReason = 'invalid-stage-ticket';
    }
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
    const rankedPlayer = this.rankedRunState?.player;
    const stats = rankedPlayer ? {
      maxHp:rankedPlayer.maxHp,
      attack:rankedPlayer.attack,
      defense:rankedPlayer.defense,
      critChance:rankedPlayer.critChance,
      critMultiplier:rankedPlayer.critMultiplier,
      moveSpeed:rankedPlayer.moveSpeed,
    } : derivePlayerStats(this.gameState);
    const x = rankedPlayer?.x ?? 120;
    const view = this.add.sprite(x, FLOOR_Y, 'knight', 0)
      .setOrigin(0.5, 1)
      .setDisplaySize(128, 160)
      .setDepth(10);
    this.player = {
      x,
      currentHp: rankedPlayer?.currentHp ?? this.gameState.player.currentHp,
      maxHp: stats.maxHp,
      stats,
      view,
      facingDirection:1,
      visualMoving:false,
      visualAction:null,
      pendingVisualAction:null,
    };
    this.playerAnimationCompleteHandler = (animation) => this.handleKnightAnimationComplete(animation);
    this.player.view.on(Phaser.Animations.Events.ANIMATION_COMPLETE, this.playerAnimationCompleteHandler);
    this.updatePlayerVisual(0);
  }

  createKnightAnimations() {
    if (!this.textures.exists('knight') || !this.textures.get('knight').has('19')) {
      throw new Error('Required knight sprite sheet is missing or malformed.');
    }
    for (const [name, definition] of Object.entries(KNIGHT_ANIMATIONS)) {
      const key = `knight-${name}`;
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames:this.anims.generateFrameNumbers('knight', { start:definition.start, end:definition.end }),
        frameRate:definition.frameRate,
        repeat:definition.repeat,
      });
    }
  }

  playKnightAnimation(name) {
    const key = `knight-${name}`;
    const sprite = this.player?.view;
    if (!sprite?.anims || !this.anims.exists(key)) return false;
    if (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying) sprite.play(key);
    return true;
  }

  refreshKnightAnimation() {
    if (!this.player) return;
    this.playKnightAnimation(selectKnightAnimation({
      moving:this.player.visualMoving,
      action:this.player.visualAction,
    }));
  }

  updatePlayerVisual(direction) {
    if (!this.player?.view) return;
    this.player.facingDirection = selectKnightFacing(direction, this.player.facingDirection);
    this.player.visualMoving = direction !== 0;
    this.player.view.setFlipX(this.player.facingDirection < 0);
    this.refreshKnightAnimation();
  }

  playKnightAction(action) {
    if (!this.player || !['contact', 'hit', 'defeat'].includes(action)) return false;
    const current = this.player.visualAction;
    if (action === 'defeat') {
      this.player.visualAction = 'defeat';
      this.player.pendingVisualAction = null;
      return this.playKnightAnimation('defeat');
    }
    if (current === 'defeat') return false;
    if (action === 'hit' && current === 'contact') {
      this.player.pendingVisualAction = 'hit';
      return true;
    }
    if (current === 'hit' && action === 'contact') return false;
    if (current === action) return true;
    this.player.visualAction = action;
    this.player.pendingVisualAction = null;
    return this.playKnightAnimation(action);
  }

  handleKnightAnimationComplete(animation) {
    const action = animation?.key?.replace(/^knight-/, '');
    if (!['contact', 'hit'].includes(action) || this.player?.visualAction !== action) return;
    const pending = this.player.pendingVisualAction;
    this.player.visualAction = null;
    this.player.pendingVisualAction = null;
    if (pending) this.playKnightAction(pending);
    else this.refreshKnightAnimation();
  }

  spawnStage() {
    if (this.rankedRunState) {
      const enemies = this.rankedRunState.enemies;
      this.normalEnemyCount = enemies.filter((enemy) => !enemy.isBoss).length;
      this.hasBoss = this.rankedRunState.hasBoss;
      enemies.forEach((enemy, index) => this.createEnemy(enemy.x, enemy.isBoss, index + 1, enemy));
      return;
    }
    const { min, max } = BALANCE.normalEnemyCount;
    this.normalEnemyCount = this.normalEnemyCountOverride ?? min + Math.floor(Math.random() * (max - min + 1));
    this.normalEnemyCountOverride = null;
    for (let index = 0; index < this.normalEnemyCount; index += 1) {
      const x = 700 + index * 950;
      this.createEnemy(x, false, index + 1);
    }
    this.hasBoss = this.stage % 5 === 0;
  }

  checkStageGoldCapacity() {
    this.stageGoldRequirement = getStageGoldRequirement(this.normalEnemyCount, this.hasBoss);
    const result = grantGold(this.gameState, this.stageGoldRequirement);
    if (!result.ok) this.showGoldRewardFailure(result.reason, this.stageGoldRequirement, { beforeCombat:true });
  }

  createEnemy(x, isBoss, index = 0, simulatedEnemy = null) {
    const stats = simulatedEnemy ?? getStageEnemyStats(this.chapter, this.stage, isBoss);
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
      id: simulatedEnemy?.id ?? (isBoss ? 'boss' : 'enemy-' + index),
      x,
      width,
      currentHp: simulatedEnemy?.currentHp ?? stats.maxHp,
      maxHp: stats.maxHp,
      attack: stats.attack,
      defense: stats.defense,
      isBoss,
      active: simulatedEnemy?.active ?? true,
      view: container,
      healthFill: fill,
      healthBarWidth: barWidth,
    });
  }

  createHud() {
    this.hud = this.add.container(22, 60).setScrollFactor(0).setDepth(100);
    const bg = this.add.rectangle(260, 48, 520, 92, 0x101820, 0.9).setOrigin(0, 0);
    bg.setStrokeStyle(1, 0x68798a);
    this.chapterText = this.add.text(14, 10, '', { fontFamily:'sans-serif', fontSize:'17px', color:'#f4e6bf' });
    this.playerText = this.add.text(14, 39, '', { fontFamily:'sans-serif', fontSize:'14px', color:'#e4ebf1' });
    this.hpBack = this.add.rectangle(14, 69, 330, 13, 0x313b45).setOrigin(0, 0);
    this.hpFill = this.add.rectangle(14, 69, 330, 13, 0x54c17a).setOrigin(0, 0);
    this.enemyText = this.add.text(360, 40, '', { fontFamily:'sans-serif', fontSize:'14px', color:'#f2c4a5' });
    this.hud.add([bg,this.chapterText,this.playerText,this.hpBack,this.hpFill,this.enemyText]);
    this.rankedStatusText = this.add.text(930, 60, '', {
      fontFamily:'sans-serif', fontSize:'14px', color:'#e4ebf1',
      backgroundColor:'#101820', padding:{x:10,y:6},
    }).setScrollFactor(0).setDepth(100);
    this.updateRankedStatus();
    this.updateHud();
  }

  updateRankedStatus(message) {
    if (!this.rankedStatusText?.active) return;
    const status = message ?? (this.rankedEligible
      ? '온라인 검증 진행 중'
      : this.rankedReason === 'offline' || this.rankedReason === 'network-unavailable'
        ? '오프라인 진행 · 랭킹 미적용'
        : this.rankedReason === 'input-payload-too-large' || this.rankedReason === 'too-many-input-events'
          ? '입력 기록 한도 초과 · 랭킹 미적용'
          : '로컬 진행 · 랭킹 미적용');
    this.rankedStatusText.setText(status);
  }

  markRankedUnavailable(reason) {
    this.rankedEligible = false;
    this.rankedReason = reason;
    this.updateRankedStatus();
  }

  unrankedResultMessage() {
    return this.rankedReason === 'offline' || this.rankedReason === 'network-unavailable'
      ? '오프라인 진행은 저장되며 랭킹에는 반영되지 않습니다.'
      : '온라인 검증 티켓이 없어 랭킹에는 반영되지 않습니다.';
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
    if (this.rankedRunState) {
      this.updateRankedRun(time, delta);
      return;
    }
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
    this.updatePlayerVisual(direction);
    this.handleContacts();
    if (this.finished) return;
    this.collectDrops();
    this.updateHud();
    if (this.player.currentHp <= 0) this.showGameOver();
  }

  readDirection() {
    const left = this.cursors.left.isDown;
    const right = this.cursors.right.isDown;
    return this.touchDirection || (left === right ? 0 : left ? -1 : 1);
  }

  updateRankedRun(_time, delta) {
    if (this.finished) return;
    if (this.combatPaused) {
      this.rankedAccumulator.reset();
      return;
    }
    if (this.isPortrait()) {
      this.updatePortraitState();
      this.rankedAccumulator.reset();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.markRankedUnavailable('network-unavailable');
    }
    if (this.rankedRunState.player.pendingLevelUps > 0 && this.rankedQueuedInputs.length === 0) {
      this.showLevelUp();
      this.rankedAccumulator.reset();
      return;
    }

    const { steps, discardedSteps } = this.rankedAccumulator.push(delta);
    this.rankedDiagnostics.discardedCatchUpSteps += discardedSteps;
    for (let index = 0; index < steps; index += 1) {
      if (this.finished || this.combatPaused || this.rankedRunState.outcome) break;
      if (this.rankedRunState.player.pendingLevelUps > 0 && this.rankedQueuedInputs.length === 0) {
        this.showLevelUp();
        this.rankedAccumulator.reset();
        break;
      }
      const tick = this.rankedRunState.tick;
      const tickInputs = this.rankedQueuedInputs.splice(0);
      const direction = this.readDirection();
      if (direction !== this.rankedRunState.movementDirection) {
        const recorded = this.rankedRecorder.recordMove(tick, direction);
        if (!recorded.ok) this.markRankedUnavailable(recorded.reason);
        tickInputs.push({ tick, kind:'move', value:direction });
      }
      const result = stepRankedRun(this.rankedRunState, tickInputs);
      this.applyRankedStep(result);
      if (this.finished) break;
      this.collectDrops();
      this.updateHud();
      if (this.rankedRunState.player.pendingLevelUps > 0) {
        this.showLevelUp();
        this.rankedAccumulator.reset();
        break;
      }
    }
  }

  applyRankedStep({ state, events }) {
    this.rankedRunState = state;
    this.player.x = state.player.x;
    this.player.currentHp = state.player.currentHp;
    this.player.maxHp = state.player.maxHp;
    this.player.stats = {
      maxHp:state.player.maxHp,
      attack:state.player.attack,
      defense:state.player.defense,
      critChance:state.player.critChance,
      critMultiplier:state.player.critMultiplier,
      moveSpeed:state.player.moveSpeed,
    };
    this.player.view.x = this.player.x;
    this.updatePlayerVisual(state.movementDirection);
    this.gameState = {
      ...this.gameState,
      player:{ ...this.gameState.player, currentHp:this.player.currentHp },
    };

    for (const simulatedEnemy of state.enemies) {
      const enemy = this.enemies.find((candidate) => candidate.id === simulatedEnemy.id);
      if (!enemy) continue;
      enemy.currentHp = simulatedEnemy.currentHp;
      enemy.healthFill.setScale(Math.max(0, simulatedEnemy.currentHp / simulatedEnemy.maxHp), 1);
    }
    for (const event of events) {
      if (event.type === 'contact') {
        const target = this.enemies.find((enemy) => enemy.id === event.targetId);
        this.playKnightAction('contact');
        if (event.playerDamage > 0 && event.playerHp > 0) this.playKnightAction('hit');
        if (event.critical) {
          this.player.view.setAlpha(0.6);
          this.time.delayedCall(110, () => this.player?.view?.setAlpha(1));
        }
        if (target) this.showDamageText(target.x, FLOOR_Y - 115, event.enemyDamage, event.critical, 0xffd36e);
      } else if (event.type === 'enemyDefeated') {
        const enemy = this.enemies.find((candidate) => candidate.id === event.targetId);
        if (enemy?.active) this.defeatEnemy(enemy, {
          ranked:true,
          playerDied:events.some((candidate) => candidate.type === 'playerDeath'),
        });
      } else if (event.type === 'bossSpawned') {
        this.hasBoss = true;
        const boss = state.enemies.find((enemy) => enemy.id === 'boss');
        if (boss && !this.enemies.some((enemy) => enemy.id === 'boss')) this.createEnemy(event.x, true, 0, boss);
      } else if (event.type === 'stageClear') {
        this.finishStage();
      } else if (event.type === 'playerDeath') {
        this.showGameOver();
      }
      if (this.goldRewardFailureShown) break;
    }
    if (events.some((event) => event.type === 'contact' || event.type === 'playerDeath')) {
      this.saveState(this.gameState);
    }
    this.updateHud();
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
      this.playKnightAction('contact');
      if (result.playerDamage > 0 && result.playerHp > 0) this.playKnightAction('hit');
      this.gameState = { ...this.gameState, player:{ ...this.gameState.player, currentHp:this.player.currentHp } };
      this.saveState(this.gameState);
      enemy.healthFill.setScale(Math.max(0, enemy.currentHp / enemy.maxHp), 1);
      if (result.critical) {
        this.player.view.setAlpha(0.6);
        this.time.delayedCall(110, () => this.player?.view?.setAlpha(1));
      }
      this.showDamageText(enemy.x, FLOOR_Y - 115, result.enemyDamage, result.critical, 0xffd36e);
      if (result.enemyDefeated) this.defeatEnemy(enemy, { playerDied:this.player.currentHp <= 0 });
      if (this.goldRewardFailureShown) return;
      if (this.player.currentHp <= 0) {
        this.gameState = retryStage(this.stageSnapshot, this.gameState).state;
        this.saveState(this.gameState);
        this.showGameOver();
        return;
      }
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

  defeatEnemy(enemy, { ranked = false, playerDied = false } = {}) {
    if (!enemy?.active) return;
    const goldReward = grantGold(this.gameState, enemy.isBoss ? BALANCE.goldRewards.boss : BALANCE.goldRewards.normalEnemy);
    if (!goldReward.ok) {
      this.showGoldRewardFailure(goldReward.reason, this.stageGoldRequirement);
      return;
    }
    enemy.active = false;
    enemy.view.setVisible(false);
    this.normalDefeated += enemy.isBoss ? 0 : 1;
    this.gameState = goldReward.state;
    if (!enemy.isBoss) {
      const reward = grantXp(this.gameState, BALANCE.xpRewards.normalEnemy, this.isReplay);
      if (reward.ok) this.gameState = reward.state;
    }
    if (enemy.isBoss) {
      if (!playerDied) this.dropGear(enemy.x, true);
      if (!ranked && !playerDied) this.finishStage();
      return;
    }
    if (!playerDied && Math.random() < BALANCE.normalDropChance) this.dropGear(enemy.x, false);
    if (!ranked && !playerDied && this.normalDefeated >= this.normalEnemyCount) {
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
    this.levelModal.add(this.add.rectangle(640, 360, 500, 414, 0x202d3b).setStrokeStyle(2, 0xd8ba77));
    this.levelModal.add(this.add.text(640, 184, '레벨 업!  능력치를 선택하세요', { fontFamily:'sans-serif',fontSize:'23px',color:'#ffdf94' }).setOrigin(0.5));
    this.levelModal.add(this.add.text(640, 218, '이번 레벨에서 0~2점을 배정할 수 있습니다.', { fontFamily:'sans-serif',fontSize:'14px',color:'#d4dde7' }).setOrigin(0.5));
    this.levelModal.add(this.add.text(640, 247, `미사용 ${this.gameState.player.availableStatPoints}점 · 이번 레벨 +2점`, { fontFamily:'sans-serif',fontSize:'15px',color:'#f4e6bf' }).setOrigin(0.5));
    const labels={attack:'공격력',defense:'방어력',maxHp:'최대 HP'};
    const choices=[['attack','공격력 +5'],['defense','방어력 +10'],['maxHp','최대 HP +30']];
    const allocations=[];
    const selected=this.add.text(640, 276, '선택: 보류', { fontFamily:'sans-serif',fontSize:'14px',color:'#c8d4df' }).setOrigin(0.5);
    this.levelModal.add(selected);
    const refreshSelected=()=>selected.setText(allocations.length
      ? `선택: ${allocations.map((key)=>labels[key]).join(' + ')}`
      : '선택: 보류');
    this.levelModalButtons=[];
    choices.forEach(([key,label],index)=>{
      const button=createButton(this,{x:445,y:300+index*54,width:390,height:46,label,onClick:()=>{
        if (allocations.length >= 2) return;
        allocations.push(key);
        refreshSelected();
      }});
      button.setDepth(201);
      this.levelModal.add(button);
      this.levelModalButtons.push(button);
    });
    const confirmLevelUp=(selectedAllocations)=>{
      const result=resolveLevelUp(this.gameState,selectedAllocations);
      if(!result.ok)return;
      if (this.rankedRunState && !this.rankedRunState.outcome) {
        const tick = this.rankedRunState.tick;
        const recorded = this.rankedRecorder.recordLevelUp(tick, selectedAllocations);
        if (!recorded.ok) this.markRankedUnavailable(recorded.reason);
        this.rankedQueuedInputs.push({ tick, kind:'levelUp', value:[...selectedAllocations] });
      }
      this.gameState=result.state;
      this.player.stats=derivePlayerStats(this.gameState);
      this.player.maxHp=this.player.stats.maxHp;
      this.player.currentHp=Math.min(this.player.maxHp,this.gameState.player.currentHp);
      this.gameState={...this.gameState,player:{...this.gameState.player,currentHp:this.player.currentHp}};
      this.saveState(this.gameState);
      this.levelModal.destroy(true);
      this.levelModalButtons=[];
      this.levelModal=null;
      this.combatPaused=this.isPortrait();
      if(this.gameState.player.pendingLevelUps>0)this.showLevelUp();
      else if(this.pendingStageClear){const next=this.pendingStageClear;this.pendingStageClear=null;this.showStageClear(next.nextChapter,next.nextStage);}
      this.updateHud();
    };
    const undo=createButton(this,{x:421,y:495,width:145,height:44,label:'마지막 선택 취소',onClick:()=>{
      if (allocations.length) allocations.pop();
      refreshSelected();
    }}).setDepth(201);
    const defer=createButton(this,{x:572,y:495,width:132,height:44,label:'이번엔 보류',onClick:()=>confirmLevelUp([])}).setDepth(201);
    const confirm=createButton(this,{x:710,y:495,width:149,height:44,label:'선택 확정',onClick:()=>confirmLevelUp([...allocations])}).setDepth(201);
    this.levelModal.add([undo,defer,confirm]);
    this.levelModalButtons.push(undo,defer,confirm);
  }

  showMessage(message) {
    if (this.messageText?.active) return;
    this.messageText=this.add.text(640,360,message,{fontFamily:'sans-serif',fontSize:'28px',color:'#ffffff',backgroundColor:'#101820',padding:{x:24,y:18}}).setOrigin(0.5).setScrollFactor(0).setDepth(300);
  }

  clearMessage() {
    this.messageText?.destroy();
    this.messageText=null;
  }

  showGoldRewardFailure(reason, requiredGold, { beforeCombat = false } = {}) {
    if (this.goldRewardFailureShown) return;
    this.goldRewardFailureShown = true;
    this.goldFailureBeforeCombat = beforeCombat;
    const recoveryGoldRequirement = beforeCombat
      ? requiredGold
      : getStageGoldRequirement(BALANCE.normalEnemyCount.max, this.hasBoss);
    const repair = reason === 'gold-overflow'
      ? createGoldRoom(this.gameState, recoveryGoldRequirement)
      : reason === 'invalid-gold'
        ? resetInvalidGoldBalance(this.gameState)
        : { ok:false, reason };
    this.finished = true;
    this.combatPaused = true;
    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(260);
    overlay.add(this.add.rectangle(640, 360, 1280, 720, 0x080c11, 0.82));
    overlay.add(this.add.rectangle(640, 345, 600, 320, 0x2b2225).setStrokeStyle(2, 0xb65e62));
    overlay.add(this.add.text(640, 255, '골드 보상을 처리할 수 없습니다', {
      fontFamily:'sans-serif', fontSize:'24px', color:'#ffb6ad',
    }).setOrigin(0.5));
    const detail = reason === 'gold-overflow'
      ? `이 스테이지 보상 ${recoveryGoldRequirement.toLocaleString()}G를 더하면 안전한 골드 범위를 넘습니다.`
      : '저장된 골드 값이 유효하지 않습니다.';
    overlay.add(this.add.text(640, 305, detail, {
      fontFamily:'sans-serif', fontSize:'15px', color:'#e2d0cd',
    }).setOrigin(0.5));
    const repairDetail = reason === 'gold-overflow' && repair.ok
      ? `${repair.adjustment.toLocaleString()}G를 조정하면 이 스테이지의 보상을 받을 수 있습니다.`
      : reason === 'invalid-gold'
        ? '복구를 선택하면 골드 잔액만 0G로 초기화됩니다.'
        : '골드 잔액을 복구할 수 없습니다.';
    overlay.add(this.add.text(640, 334, repairDetail, {
      fontFamily:'sans-serif', fontSize:'15px', color:'#e2d0cd',
    }).setOrigin(0.5));
    if (reason === 'gold-overflow' && repair.ok && repair.adjustment > 0) {
      overlay.add(this.add.text(640, 356, '사망하면 아직 받지 않은 보상은 차감액으로 돌려받지 않습니다.', {
        fontFamily:'sans-serif', fontSize:'13px', color:'#e2d0cd',
      }).setOrigin(0.5));
    }
    if (repair.ok) {
      const repairLabel = reason === 'gold-overflow'
        ? `골드 ${repair.adjustment.toLocaleString()}G 조정 후 재시작`
        : '골드 0G로 복구 후 재시작';
      createButton(this, {
        x:445, y:398, width:390, height:54, label:repairLabel,
        onClick:() => { void this.restartStageAfterGoldRepair(repair.state); },
      }).setDepth(261);
    }
    createButton(this, {
      x:480, y:458, width:320, height:42, label:'마을로 돌아가기',
      onClick:() => { void this.returnToTownAfterGoldFailure(); },
    }).setDepth(261);
  }

  async restartStageAfterGoldRepair(repairedState) {
    if (this.transitioning) return;
    this.transitioning = true;
    const retry = this.goldFailureBeforeCombat
      ? { ...repairedState }
      : { ...retryStage(this.stageSnapshot, this.gameState).state, gold:repairedState.gold };
    this.saveState(retry);
    let ranked = { ranked:false, reason:this.rankedReason };
    if (this.goldFailureBeforeCombat && this.rankedTicket && this.rankedRunClient) {
      ranked = { ranked:true, ticket:this.rankedTicket, gameState:retry };
    } else if (!this.goldFailureBeforeCombat && this.rankedRunClient) {
      try {
        if (this.rankedTicket) await this.rankedRunClient.abandonRun(this.rankedTicket);
        ranked = await this.rankedRunClient.prepareStage({ chapter:this.chapter, stage:this.stage, gameState:retry });
      } catch {
        ranked = { ranked:false, reason:'ticket-request-failed' };
      }
    }
    const gameState = ranked.gameState ?? retry;
    const stageSnapshot = typeof structuredClone === 'function'
      ? structuredClone(gameState)
      : JSON.parse(JSON.stringify(gameState));
    this.scene.restart({
      gameState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
      rankedTicket:ranked.ranked ? ranked.ticket : null,
      rankedReason:ranked.reason,
      chapter:this.chapter,
      stage:this.stage,
      isReplay:this.isReplay,
      normalEnemyCountOverride:this.goldFailureBeforeCombat && !ranked.ranked ? this.normalEnemyCount : null,
      stageSnapshot,
    });
  }

  async returnToTownAfterGoldFailure() {
    if (this.transitioning) return;
    this.transitioning = true;
    if (this.rankedTicket && this.rankedRunClient) {
      try {
        await this.rankedRunClient.abandonRun(this.rankedTicket);
      } catch {
        // Returning to the town remains available if the run ticket cannot be abandoned.
      }
    }
    this.scene.start('TownScene', {
      gameState:this.gameState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
      unlockedStageId:`${this.chapter}-${this.stage}`,
    });
  }

  finishStage() {
    if (this.finished) return;
    this.combatPaused=true;
    const completed=completeStage(this.gameState,this.chapter,this.stage);
    if (!completed.ok) {
      this.showGoldRewardFailure(completed.reason, this.stageGoldRequirement);
      return;
    }
    this.finished=true;
    this.gameState={...completed.state,progression:{...completed.state.progression,chapter:completed.nextChapter,currentStage:completed.nextStage}};
    this.player.currentHp=this.gameState.player.currentHp;
    this.saveState(this.gameState);
    this.submitRankedClear();
    this.updateHud();
    if(this.gameState.player.pendingLevelUps>0){
      this.pendingStageClear={nextChapter:completed.nextChapter,nextStage:completed.nextStage};
      this.showLevelUp();
    }else this.showStageClear(completed.nextChapter,completed.nextStage);
  }

  submitRankedClear() {
    if (!this.rankedTicket || !this.rankedRunClient || this.rankedRunState?.outcome !== 'clear') return;
    if (this.rankedRecorder.getError()) this.markRankedUnavailable(this.rankedRecorder.getError());
    if (!this.rankedEligible) {
      this.rankResultMessage = this.rankedReason === 'network-unavailable'
        ? '연결이 끊겨 진행만 저장했습니다. 랭킹에는 반영되지 않습니다.'
        : '이 플레이는 온라인 검증 조건을 충족하지 않아 랭킹에 반영되지 않습니다.';
      this.updateRankedStatus('랭킹 미적용');
      return;
    }

    this.rankResultMessage = '서버에서 입력 기록을 확인하고 있습니다...';
    this.updateRankedStatus('랭킹 검증 중');
    void this.rankedRunClient.submitResult(this.rankedTicket, this.rankedRecorder.getInputs()).then((result) => {
      if (result.verified) {
        this.rankResultMessage = '서버 검증 완료 · 기록 ' + (result.clearTimeMs / 1000).toFixed(2) + '초';
        this.updateRankedStatus('서버 검증 완료');
      } else {
        this.markRankedUnavailable(result.code);
        const message = result.code === 'run-expired'
          ? '랭킹 티켓 유효 시간이 지나 진행만 저장했습니다.'
          : result.code === 'authentication-required'
            ? '인증이 만료되어 진행만 저장했습니다. 다시 로그인해 주세요.'
          : result.code === 'run-not-cleared' || result.code === 'run-too-fast'
            ? '서버 재생 검증을 통과하지 못해 랭킹에 반영되지 않았습니다.'
            : result.code?.startsWith('run-') || result.code?.startsWith('unsupported-')
              ? '랭킹 티켓 상태를 확인할 수 없어 진행만 저장했습니다.'
              : '연결 상태를 확인할 수 없어 진행만 저장했습니다.';
        this.rankResultMessage = message;
      }
      if (this.rankResultText?.active) this.rankResultText.setText(this.rankResultMessage);
    }).catch(() => {
      this.markRankedUnavailable('network-unavailable');
      this.rankResultMessage = '연결 상태를 확인할 수 없어 진행만 저장했습니다.';
      if (this.rankResultText?.active) this.rankResultText.setText(this.rankResultMessage);
    });
  }

  showStageClear(nextChapter,nextStage) {
    const overlay=this.add.container(0,0).setScrollFactor(0).setDepth(250);
    overlay.add(this.add.rectangle(640,360,1280,720,0x080c11,0.78));
    overlay.add(this.add.rectangle(640,345,560,300,0x202d3b).setStrokeStyle(2,0xd8ba77));
    overlay.add(this.add.text(640,245,'스테이지 완료',{fontFamily:'sans-serif',fontSize:'30px',color:'#ffdf94'}).setOrigin(0.5));
    overlay.add(this.add.text(640,290,this.chapter+'-'+this.stage+' 클리어 · XP +'+BALANCE.xpRewards.stageClear,{fontFamily:'sans-serif',fontSize:'17px',color:'#e4ebf1'}).setOrigin(0.5));
    this.rankResultText = this.add.text(640, 324, this.rankResultMessage ?? this.unrankedResultMessage(), {
      fontFamily:'sans-serif',fontSize:'14px',color:'#b9d8c5',
    }).setOrigin(0.5);
    overlay.add(this.rankResultText);
    createButton(this,{x:355,y:350,width:230,height:58,label:'마을로',onClick:()=>{
      if(this.transitioning)return;
      this.transitioning=true;
      this.scene.start('TownScene',{
        gameState:this.gameState,
        saveState:this.saveState,
        rankedRunClient:this.rankedRunClient,
        pvpClient:this.pvpClient,
        rankingClient:this.rankingClient,
        unlockedStageId:nextChapter+'-'+nextStage,
      });
    }}).setDepth(251);
    createButton(this,{x:600,y:350,width:325,height:58,label:'다음 스테이지 '+nextChapter+'-'+nextStage,onClick:()=>{
      void this.startNextStage(nextChapter, nextStage);
    }}).setDepth(251);
  }

  async startNextStage(chapter, stage) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.saveState(this.gameState);
    let ranked = { ranked:false, reason:'ranking-unavailable' };
    if (this.rankedRunClient) {
      try {
        ranked = await this.rankedRunClient.prepareStage({ chapter, stage, gameState:this.gameState });
      } catch {
        ranked = { ranked:false, reason:'ticket-request-failed' };
      }
    }
    const gameState = ranked.gameState ?? this.gameState;
    const stageSnapshot = typeof structuredClone === 'function'
      ? structuredClone(gameState)
      : JSON.parse(JSON.stringify(gameState));
    this.scene.start('BattleScene', {
      gameState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
      rankedTicket:ranked.ranked ? ranked.ticket : null,
      rankedReason:ranked.reason,
      chapter,
      stage,
      isReplay:false,
      stageSnapshot,
    });
  }

  showGameOver() {
    if (this.finished) return;
    this.finished=true;
    this.combatPaused=true;
    const showOverlay = () => {
      if (this.gameOverOverlayShown) return;
      this.gameOverOverlayShown = true;
      const overlay=this.add.container(0,0).setScrollFactor(0).setDepth(250);
      overlay.add(this.add.rectangle(640,360,1280,720,0x080c11,0.8));
      overlay.add(this.add.rectangle(640,345,520,260,0x2b2225).setStrokeStyle(2,0xb65e62));
      overlay.add(this.add.text(640,255,'쓰러졌습니다',{fontFamily:'sans-serif',fontSize:'29px',color:'#ffb6ad'}).setOrigin(0.5));
      overlay.add(this.add.text(640,300,'이번 도전의 장비와 재료는 입장 시점으로 돌아갑니다.',{fontFamily:'sans-serif',fontSize:'15px',color:'#e2d0cd'}).setOrigin(0.5));
      createButton(this,{x:480,y:365,width:320,height:58,label:'다시 시작',onClick:()=>{
        void this.restartStageAfterDeath();
      }}).setDepth(251);
    };
    const sprite = this.player?.view;
    if (sprite && this.anims.exists('knight-defeat')) {
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE_KEY + 'knight-defeat', showOverlay);
      this.playKnightAction('defeat');
      this.time.delayedCall(900, showOverlay);
      return;
    }
    showOverlay();
  }

  async restartStageAfterDeath() {
    if (this.transitioning) return;
    this.transitioning = true;
    const result = retryStage(this.stageSnapshot, this.gameState);
    this.saveState(result.state);
    let ranked = { ranked:false, reason:this.rankedReason };
    if (this.rankedRunClient) {
      try {
        if (this.rankedTicket) await this.rankedRunClient.abandonRun(this.rankedTicket);
        ranked = await this.rankedRunClient.prepareStage({
          chapter:this.chapter,
          stage:this.stage,
          gameState:result.state,
        });
      } catch {
        ranked = { ranked:false, reason:'ticket-request-failed' };
      }
    }
    const gameState = ranked.gameState ?? result.state;
    const stageSnapshot = typeof structuredClone === 'function'
      ? structuredClone(gameState)
      : JSON.parse(JSON.stringify(gameState));
    this.scene.restart({
      gameState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
      rankedTicket:ranked.ranked ? ranked.ticket : null,
      rankedReason:ranked.reason,
      chapter:this.chapter,
      stage:this.stage,
      isReplay:this.isReplay,
      stageSnapshot,
    });
  }
}
