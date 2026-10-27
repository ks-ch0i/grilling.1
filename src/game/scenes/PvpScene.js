import Phaser from 'phaser';
import { createPvpRun, stepPvpRun } from '@knight-run/game-rules/simulation';
import { createRunInputRecorder, RANKED_TICK_MS } from '../domain/rankedRunClient.js';
import { RankingMarquee } from '../ui/RankingMarquee.js';
import { WholeBodyWalk, WALK_CHARACTERS } from '../ui/WholeBodyWalk.js';
import { EquipmentAppearance } from '../ui/equipmentAppearance.js';
import { getPvpFacingDirections, validatePvpEquipmentSnapshot } from '../ui/pvpCharacterAppearance.js';
import { createStaticSceneBackground } from '../ui/sceneBackgrounds.js';

const FLOOR_Y = 560;
const MATCH_TICKS = 60 * 60;

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export class PvpScene extends Phaser.Scene {
  constructor() {
    super('PvpScene');
  }

  init(data = {}) {
    this.ticket = data.ticket;
    this.gameState = data.gameState;
    this.saveState = typeof data.saveState === 'function' ? data.saveState : () => {};
    this.pvpClient = data.pvpClient;
    this.rankedRunClient = data.rankedRunClient;
    this.rankingClient = data.rankingClient;
    this.recorder = createRunInputRecorder();
    this.queuedInputs = [];
    this.direction = 0;
    this.finished = false;
    this.submitting = false;
    this.playerView = null;
    this.opponentView = null;
  }

  create() {
    this.rankingMarquee = new RankingMarquee(this, this.rankingClient);
    this.arenaBackground = createStaticSceneBackground(this, 'pvp');
    this.add.text(32, 72, '비동기 PvP · 서버 판정 대기', { fontFamily:'sans-serif', fontSize:'27px', color:'#f4e6bf' });
    this.add.text(32, 110, '상대는 공개 스냅샷 위치에 고정됩니다. 몸통 접촉으로 피해를 주고받습니다.', { fontFamily:'sans-serif', fontSize:'15px', color:'#cad4df' });
    this.add.rectangle(640, FLOOR_Y + 20, 1280, 320, 0x263342);
    this.add.rectangle(640, FLOOR_Y, 1280, 8, 0xd8ba77);
    this.clockLabel = this.add.text(640, 160, '60초', { fontFamily:'sans-serif', fontSize:'26px', color:'#ffcf45' }).setOrigin(0.5);
    this.statusLabel = this.add.text(640, 198, '결과와 레이팅은 서버 응답으로만 표시합니다.', { fontFamily:'sans-serif', fontSize:'14px', color:'#d3dce4' }).setOrigin(0.5);

    try {
      if (!this.ticket || !this.ticket.playerSnapshot?.combat || !this.ticket.opponentSnapshot?.combat || !this.pvpClient) {
        throw new TypeError('PvP ticket data is incomplete.');
      }
      validatePvpEquipmentSnapshot(this.ticket.playerSnapshot.equipment);
      validatePvpEquipmentSnapshot(this.ticket.opponentSnapshot.equipment);
      const issued = Date.parse(this.ticket.issuedAtUtc);
      const expires = Date.parse(this.ticket.expiresAtUtc);
      if (!Number.isFinite(issued) || !Number.isFinite(expires) || Date.now() >= expires) {
        this.showSubmissionFailure('match-expired');
        return;
      }
      this.runState = createPvpRun(this.ticket, this.ticket.playerSnapshot.combat, this.ticket.opponentSnapshot.combat);
      const elapsedTicks = Math.min(MATCH_TICKS, Math.max(0, Math.floor((Date.now() - issued) / RANKED_TICK_MS)));
      while (this.runState.tick < elapsedTicks && !this.runState.outcome) {
        this.runState = stepPvpRun(this.runState, []).state;
      }
      if (this.runState.outcome || elapsedTicks >= MATCH_TICKS) {
        this.finishMatch();
        return;
      }
    } catch {
      this.showSubmissionFailure('invalid-match-ticket');
      return;
    }

    try {
      this.playerView = this.createCharacterView(this.runState.player.x, this.ticket.playerSnapshot.equipment);
      this.opponentView = this.createCharacterView(this.runState.opponent.x, this.ticket.opponentSnapshot.equipment);
    } catch {
      this.playerView?.container.destroy(true);
      this.opponentView?.container.destroy(true);
      this.playerView = null;
      this.opponentView = null;
      this.showSubmissionFailure('invalid-match-ticket');
      return;
    }
    const playerName = `나 · Lv.${this.ticket.playerSnapshot.character?.level ?? '?'} · ${this.ticket.playerRating ?? '—'}점`;
    const opponentName = `${this.ticket.opponentDisplayName || '상대'} · Lv.${this.ticket.opponentSnapshot.character?.level ?? '?'} · ${this.ticket.opponentRating ?? '—'}점`;
    this.add.text(32, 240, playerName, { fontFamily:'sans-serif', fontSize:'16px', color:'#b7dcff' });
    this.add.text(915, 240, opponentName, { fontFamily:'sans-serif', fontSize:'16px', color:'#ffc4b8' }).setOrigin(1, 0);
    this.playerHpFill = this.add.rectangle(32, 273, 320, 13, 0x67cf88).setOrigin(0, 0.5);
    this.opponentHpFill = this.add.rectangle(928, 273, 320, 13, 0xe86d64).setOrigin(1, 0.5);
    this.add.text(640, 620, '이동: A/D 또는 ←/→ · 화면 왼쪽/오른쪽을 누르세요', { fontFamily:'sans-serif', fontSize:'15px', color:'#d1dae3' }).setOrigin(0.5);
    this.cursors = this.input.keyboard.addKeys({ left:'A', right:'D', arrowLeft:'LEFT', arrowRight:'RIGHT' });
    this.input.on('pointerdown', (pointer) => { this.touchDirection = pointer.x < this.scale.width / 2 ? -1 : 1; });
    this.input.on('pointerup', () => { this.touchDirection = 0; });
    this.input.on('pointerupoutside', () => { this.touchDirection = 0; });
    this.touchDirection = 0;
    this.renderCombatState();
  }

  createCharacterView(x, equipment) {
    let container;
    try {
      container = this.add.container(x, FLOOR_Y).setDepth(10);
      const walkRig = new WholeBodyWalk(this, container, 'knight', { renderBase:false });
      const metadata = this.cache.json.get('walk-knight-meta');
      if (!Number.isFinite(metadata?.contentHeight) || metadata.contentHeight <= 0) {
        throw new TypeError('Mounted knight texture metadata is unavailable.');
      }
      const appearance = new EquipmentAppearance(this, container, equipment, {
        scale:WALK_CHARACTERS.knight.walkHeight / metadata.contentHeight,
        layout:'mounted',
      });
      return { container, walkRig, appearance, lastX:x };
    } catch (error) {
      container?.destroy(true);
      throw error;
    }
  }

  getInputDirection() {
    if (this.touchDirection) return this.touchDirection;
    if (this.cursors?.left?.isDown || this.cursors?.arrowLeft?.isDown) return -1;
    if (this.cursors?.right?.isDown || this.cursors?.arrowRight?.isDown) return 1;
    return 0;
  }

  update(_time, delta = 0) {
    if (this.finished || !this.runState) return;
    const elapsedMs = Date.now() - Date.parse(this.ticket.issuedAtUtc);
    const targetTick = Math.min(MATCH_TICKS, Math.max(0, Math.floor(elapsedMs / RANKED_TICK_MS)));
    const nextDirection = this.getInputDirection();
    if (nextDirection !== this.direction) {
      const recorded = this.recorder.recordMove(this.runState.tick, nextDirection);
      if (!recorded.ok) {
        this.showSubmissionFailure(recorded.reason);
        return;
      }
      if (recorded.recorded) this.queuedInputs.push({ tick:this.runState.tick, kind:'move', value:nextDirection });
      this.direction = nextDirection;
    }
    while (this.runState.tick < targetTick && !this.runState.outcome) {
      const tickInputs = [];
      while (this.queuedInputs[0]?.tick === this.runState.tick) tickInputs.push(this.queuedInputs.shift());
      this.runState = stepPvpRun(this.runState, tickInputs).state;
    }
    this.renderCombatState(delta);
    if (this.runState.outcome) this.finishMatch();
  }

  renderCombatState(delta = 0) {
    if (!this.runState || !this.playerView || !this.opponentView) return;
    const playerX = this.runState.player.x;
    const opponentX = this.runState.opponent.x;
    const facing = getPvpFacingDirections(playerX, opponentX);
    for (const [view, x, direction] of [
      [this.playerView, playerX, facing.player],
      [this.opponentView, opponentX, facing.opponent],
    ]) {
      const moving = Math.abs(x - view.lastX) > 0.01;
      view.container.x = x;
      view.walkRig.follow(x, moving, direction, Math.max(0, delta / 1000));
      view.appearance.setFacing(direction).setFrame(view.walkRig.frame);
      view.lastX = x;
    }
    this.playerHpFill.width = 320 * Math.max(0, this.runState.player.currentHp / this.runState.player.maxHp);
    this.opponentHpFill.width = 320 * Math.max(0, this.runState.opponent.currentHp / this.runState.opponent.maxHp);
    const secondsLeft = Math.max(0, 60 - Math.floor(this.runState.tick / 60));
    this.clockLabel.setText(`${secondsLeft}초`);
  }

  async finishMatch() {
    if (this.submitting || !this.ticket || !this.pvpClient) return;
    this.finished = true;
    this.submitting = true;
    this.statusLabel?.setText('전투 기록을 서버에서 확인하고 있습니다...');
    const inputs = this.recorder.getInputs();
    await this.submitRecordedInputs(inputs);
  }

  async submitRecordedInputs(inputs) {
    const response = await this.pvpClient.submitMatch(this.ticket, inputs);
    this.submitting = false;
    if (!response?.ok) {
      this.showSubmissionFailure(response?.reason ?? 'network-unavailable', inputs);
      return;
    }
    this.showVerifiedResult(response.result);
  }

  showOverlay(title, message, actions) {
    this.overlay?.destroy(true);
    const overlay = this.add.container(0, 0).setDepth(300);
    this.overlay = overlay;
    overlay.add(this.add.rectangle(640, 360, 600, 300, 0x090e14, 0.96).setStrokeStyle(2, 0xd8ba77));
    overlay.add(this.add.text(640, 270, title, { fontFamily:'sans-serif', fontSize:'26px', color:'#f4e6bf' }).setOrigin(0.5));
    overlay.add(this.add.text(640, 335, message, { fontFamily:'sans-serif', fontSize:'16px', color:'#cad4df', align:'center', wordWrap:{ width:510 }, lineSpacing:7 }).setOrigin(0.5));
    const width = Math.min(190, 470 / Math.max(1, actions.length));
    const total = width * actions.length + Math.max(0, actions.length - 1) * 12;
    actions.forEach((action, index) => {
      const x = 640 - total / 2 + width / 2 + index * (width + 12);
      const button = this.add.rectangle(x, 445, width, 48, 0x344659).setStrokeStyle(1, 0xd8ba77);
      const label = this.add.text(x, 445, action.label, { fontFamily:'sans-serif', fontSize:'15px', color:'#fff3d5' }).setOrigin(0.5);
      const invoke = () => { void action.onClick(); };
      button.setInteractive({ useHandCursor:true }).on('pointerdown', invoke);
      label.setInteractive({ useHandCursor:true }).on('pointerdown', invoke);
      overlay.add([button, label]);
    });
  }

  showVerifiedResult(result) {
    const outcomeLabel = result.outcome === 'win' ? '승리' : result.outcome === 'loss' ? '패배' : '무승부';
    const ratingLine = result.rated
      ? `내 레이팅 ${result.playerRatingBefore} → ${result.playerRatingAfter}\n상대 레이팅 ${result.opponentRatingAfter} · 남은 HP ${(result.remainingHpPercent * 100).toFixed(1)}%`
      : `오늘 같은 상대와 이미 대전해 레이팅 미반영\n내 레이팅 ${result.playerRatingBefore} → ${result.playerRatingAfter} · 상대 ${result.opponentRatingAfter}\n남은 HP ${(result.remainingHpPercent * 100).toFixed(1)}%`;
    this.showOverlay(`서버 판정 · ${outcomeLabel}`, ratingLine, [
      { label:'마을로', onClick:()=>this.returnToTown() },
    ]);
  }

  showSubmissionFailure(reason, submittedInputs = this.recorder.getInputs()) {
    this.finished = true;
    this.submitting = false;
    this.direction = 0;
    const authRequired = reason === 'authentication-required';
    const expired = reason === 'match-expired';
    const message = expired
      ? '매치 시간이 지났거나 서버 결과를 확인하지 못했습니다. 레이팅은 서버 응답을 받을 때까지 표시하지 않습니다.'
      : '서버가 전투 기록을 확인하지 못했습니다. 레이팅은 서버 응답을 받을 때까지 표시하지 않습니다.';
    const actions = [];
    if (!expired && reason !== 'invalid-match-ticket') {
      if (authRequired) actions.push({ label:'다시 인증', onClick:async()=>{
        await this.pvpClient.retryAuthentication();
        this.overlay?.destroy(true);
        this.overlay=null;
        this.submitting=true;
        await this.submitRecordedInputs(submittedInputs);
      } });
      actions.push({ label:'다시 제출', onClick:async()=>{
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        this.overlay?.destroy(true);
        this.overlay=null;
        this.submitting=true;
        await this.submitRecordedInputs(submittedInputs);
      } });
    }
    actions.push({ label:'마을로', onClick:()=>this.returnToTown() });
    this.showOverlay(authRequired ? '회사 계정 인증 필요' : '서버 판정 실패', message, actions);
  }

  returnToTown() {
    this.overlay?.destroy(true);
    this.scene.start('TownScene', {
      gameState:this.gameState,
      saveState:this.saveState,
      rankedRunClient:this.rankedRunClient,
      pvpClient:this.pvpClient,
      rankingClient:this.rankingClient,
    });
  }
}
