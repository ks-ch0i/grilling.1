const BOARD_LABELS = Object.freeze({ stage:'스테이지', pvp:'PvP' });

export function formatRankingBoard(snapshot, board, connection = 'live') {
  const topFive = snapshot?.[board]?.topFive ?? [];
  const status = connection === 'offline'
    ? '오프라인 · 저장된 기록'
    : connection === 'live' ? '실시간' : '연결 복구 중';
  if (!topFive.length) return `${BOARD_LABELS[board]} TOP 5 · 아직 검증된 기록이 없습니다 · ${status}`;
  const rows = topFive.slice(0, 5).map((entry, index) => {
    const name = String(entry.displayName ?? '기사').slice(0, 12);
    return board === 'stage'
      ? `${index + 1}. ${name} ${entry.chapter}-${entry.stage} · ${(entry.clearTimeMs / 1000).toFixed(1)}초`
      : `${index + 1}. ${name} ${entry.rating}점`;
  });
  return `${BOARD_LABELS[board]} TOP 5 · ${rows.join('   |   ')} · ${status}`;
}

export function formatRankNotice(notice) {
  if (!notice) return '';
  const board = BOARD_LABELS[notice.board] ?? '랭킹';
  if (notice.from === null && Number.isInteger(notice.to)) return `${board} 랭킹 진입 · ${notice.to}위`;
  if (Number.isInteger(notice.from) && notice.to === null) return `${board} 순위권 밖으로 이동`;
  if (!Number.isInteger(notice.from) || !Number.isInteger(notice.to)) return `${board} 랭킹이 업데이트되었습니다`;
  const change = notice.from - notice.to;
  return change > 0
    ? `${board} ${notice.from}위 → ${notice.to}위 · ${change}계단 상승`
    : change < 0
      ? `${board} ${notice.from}위 → ${notice.to}위 · ${Math.abs(change)}계단 하락`
      : `${board} ${notice.to}위 유지`;
}

export class RankingMarquee {
  constructor(scene, rankingClient) {
    this.scene = scene;
    this.rankingClient = rankingClient;
    this.boardIndex = 0;
    this.notice = null;
    this.noticeId = null;
    this.container = scene.add.container(640, 24).setScrollFactor(0).setDepth(220);
    this.background = scene.add.rectangle(0, 0, 1216, 42, 0x101820, 0.96).setStrokeStyle(1, 0x657587);
    this.text = scene.add.text(-590, 0, '', {
      fontFamily:'sans-serif',
      fontSize:'13px',
      color:'#f4e6bf',
      wordWrap:{ width:1180 },
      maxLines:2,
    }).setOrigin(0, 0.5);
    this.container.add([this.background, this.text]);
    this.unsubscribe = rankingClient?.subscribe((snapshot) => this.onSnapshot(snapshot));
    this.rotation = scene.time.addEvent({
      delay:8_000,
      loop:true,
      callback:() => {
        this.boardIndex = (this.boardIndex + 1) % 2;
        this.renderBoard();
      },
    });
    scene.events.once('shutdown', () => this.destroy());
  }

  onSnapshot(snapshot) {
    this.snapshot = snapshot;
    const notice = snapshot?.rankNotice;
    if (notice && notice.id !== this.noticeId) {
      this.noticeId = notice.id;
      this.notice = notice;
      this.noticeTimer?.remove(false);
      this.noticeTimer = this.scene.time.delayedCall(5_000, () => {
        this.notice = null;
        this.renderBoard();
      });
    }
    this.renderBoard();
  }

  renderBoard() {
    if (!this.text?.active) return;
    this.text.setText(this.notice
      ? formatRankNotice(this.notice)
      : formatRankingBoard(this.snapshot, this.boardIndex === 0 ? 'stage' : 'pvp', this.snapshot?.connection));
  }

  destroy() {
    this.unsubscribe?.();
    this.rotation?.remove(false);
    this.noticeTimer?.remove(false);
    this.container?.destroy(true);
    this.unsubscribe = null;
  }
}
