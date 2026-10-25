# Task: T06 마을 PvP 기록 화면

## Status: done

## Goal
TownScene에서 사용자가 PvP 최근 경기 요약을 열고 최신 10경기 단위로 페이지 이동할 수 있게 한다. 결과 확인을 위해 재대전이나 데이터베이스 접근이 필요하지 않게 한다.

## Decision Summary
- 기록 버튼은 TownScene 하단 action row에 두고, 기록은 같은 화면 위 modal overlay로 표시한다.
- 한 행에는 현지 날짜/시간, 상대 이름, 승·패·무, 내 rating 변동 또는 미반영 상태만 표시한다.

## Implementation

### I01. Browser API 및 client adapter

- Related Files:
  - src/api/cloudSaveClient.js :: getPvpMatchHistory — authenticated GET wrapper; modify
  - src/game/domain/pvpClient.js :: getMatchHistory — response validation과 UI 결과; modify
  - test/api/pvp-history-client.test.js :: URL, auth, page/error mapping; new

#### Details
- Signatures & Types:
  ~~~javascript
  cloudSaveClient.getPvpMatchHistory(account, page)
  pvpClient.getMatchHistory(page)
  // successful client result:
  // { ok: true, page, pageSize: 10, hasPrevious, hasNext, items }
  // failure:
  // { ok: false, reason: string }
  ~~~
- **Execution Flow / Logic**:
  1. page는 정수 1..100000만 허용한다. cloudSaveClient는 GET /pvp/matches/history?page={page}에 기존 access token을 붙인다.
  2. 200 응답의 page, pageSize, booleans, 최대 10개 item과 각 item 필드를 검증한다. 검증 실패는 invalid-history-response다.
  3. 401/403은 authentication-required, 오프라인/네트워크 및 5xx는 network-unavailable, 기타 API code는 reason으로 보존한다.
  4. InputJson이나 snapshot 필드를 client model에 복사하거나 보관하지 않는다.

### I02. TownScene history overlay

- Related Files:
  - src/game/scenes/TownScene.js :: init, renderStagePanel, showPvpHistory, renderPvpHistory, shutdown cleanup — 기록 화면 lifecycle; modify
  - src/game/ui/pvpHistory.js :: formatPvpHistoryRow — local display formatting; new
  - test/pvp-history-view.test.js :: row formatter와 page state; new

#### Details
- **Data & Schema Fields**:
  - Town view state: historyPage: positive integer, historyRequestId: integer, pvpHistoryOverlay: Phaser container|null.
  - Item view fields: opponentDisplayName, completedAtUtc, outcome, rated, ratingBefore, ratingAfter.
- **Execution Flow / Logic**:
  1. Town 하단 action row를 재배치해 PvP 기록 버튼을 추가한다. 기존 버튼 폭/위치 기준은 prev x=32/w=150, stage label x=190, next x=445/w=150, battle x=610/w=190, history x=815/w=180, PvP x=1010/w=238, y=630/h=58로 둔다.
  2. 기록을 누르면 page 1을 요청하고 viewport-fixed overlay를 연다. overlay는 로딩, 빈 결과, 오류, 데이터 상태를 각각 표시한다.
  3. 최대 10행에 날짜/시간은 Intl.DateTimeFormat('ko-KR', { dateStyle:'short', timeStyle:'short' })로 브라우저 현지 시간 표시, 상대 이름, 한글 승/패/무, rating delta를 표시한다. rated=false이면 delta 대신 레이팅 미반영을 표시한다.
  4. 최신순 행 순서는 서버 응답을 그대로 사용한다. previous는 page>1, next는 hasNext일 때만 활성화하고 각 page 요청의 응답이 현재 historyRequestId와 다르면 버린다.
  5. 오류 상태에는 다시 시도와 닫기를 제공한다. 빈 상태에는 경기 기록이 없음을 표시한다. 닫기는 overlay를 destroy하고 기존 마을 controls를 유지한다.
  6. 기록 행에서 match id, raw input, snapshot, seed는 표시하지 않는다. 재생·장기 통계는 만들지 않는다.
  7. P01-T03의 Town keyboard controller에 history button 및 overlay controls를 등록한다.

### I03. 화면 테스트

- Related Files:
  - test/pvp-history-view.test.js :: 날짜, 결과, rating delta, 미반영, 빈·오류 UI state; new
  - src/game/ui/pvpHistory.js :: pure row formatter; new
  - src/game/scenes/TownScene.js :: stale response handling; modify

## Acceptance Criteria
- [x] TownScene에서 PvP 기록을 열고 닫을 수 있다.
- [x] 페이지당 최대 10개, 이전/다음 버튼은 실제 이동 가능한 경우에만 활성화된다.
- [x] loading, empty, error/retry, 정상 데이터 상태를 구분해 표시한다.
- [x] 서버 입력 로그와 스냅샷은 화면이나 browser client model에 노출되지 않는다.
- [x] 기록 열기/페이지 이동/닫기는 keyboard navigation과 pointer controls를 사용하며 PvP 전투 시작 버튼을 유지한다.

## Validation
- `node --test test/api/pvp-history-client.test.js test/pvp/pvpClient.test.js test/pvp-history-view.test.js` — 23 tests passed.
- `npm.cmd test` — 157 tests passed.
- `npm.cmd run build` — Vite production build 성공. Phaser 번들 크기 경고는 유지됨.
- `git diff --check` 통과.
- 브라우저 수동 확인은 미실행: 이 세션에서 CUA가 사용 가능한 browser/app surface를 반환하지 않음.

## Commit Message
~~~text
feat(town): show paginated recent PvP matches

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P02-pvp-history-and-retention
Task: T06-pvp-history-town-screen

- Add a TownScene PvP history overlay
- Display local date, opponent, outcome, and rating change
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending
