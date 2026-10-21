# Task: T07 스테이지 랭킹 클라이언트

## Status: in_progress

## Goal
BattleScene을 결정적 60Hz 입력 로그와 stage ticket에 연결하고 온라인 검증 결과만 랭킹 API에 제출한다.

## Decision Summary
- 온라인 ticket을 얻지 못해도 로컬 스테이지 플레이와 save는 계속되며 해당 run은 unranked다.
- 연결이 run 도중 끊겨도 플레이를 끝낼 수 있지만 랭킹 결과는 제출하지 않는다. 진행 save는 오프라인 저장 규칙으로 동기화한다.
- 실제 전투 stat은 ticket이 고정한 server snapshot과 같게 시작해야 한다.

## Implementation

### I01. BattleScene run 준비와 고정 timestep
- Related Files:
  - src/game/scenes/TownScene.js :: startBattle — 온라인 ticket bootstrap; modify.
  - src/game/scenes/BattleScene.js :: init, create, update, handleContacts, finishStage, showLevelUp — deterministic run 연결; modify.
  - src/game/domain/rankedRunClient.js :: requestStageTicket, recordInput, submitStageResult — API adapter; new.
  - test/ranked-stage-client.test.js :: ticket/offline/submit state machine; new.
- Details:
  - Signature: requestStageTicket(apiClient, { chapter:number, stage:number, saveRevision:number, account }): Promise<{ ok:true, ticket:RunTicket } | { ok:false, reason:string }>.
  - Ticket response contract은 T04와 일치한다. Browser는 ticket snapshot과 combat stats/effects 및 saved level/xp/xpToNext/pendingLevelUps/replayXpMultiplier를 비교한다. 현재 로컬 상태와 다르면 ticket을 종료하고 cloud save sync 후 한 번 다시 요청한다.
  - BattleScene update의 delta 누적기는 1/60초 고정 simulation step을 실행하고 render/camera는 Phaser frame에 남긴다. 한 frame에서 최대 5 tick catch-up; 초과 accumulated time은 simulation clock에 더하지 않고 browser diagnostic에 기록한다.
  - Record direction event only when resolved direction changes. tick은 시뮬레이터 tick index다. 레벨업 버튼 선택은 같은 tick의 levelUp event로 기록한다.
  - RunInputEvent schema는 T01과 동일하며 이벤트가 늘어날 때 같은 방향을 반복 저장하지 않는다. 종료 시 event count 100,000과 encoded payload 1 MiB 이하인지 검사한다.
  - online + ticket success는 ranked. network false, ticket failure, expired ticket, save revision mismatch, mid-run request failure 중 하나면 run state를 unranked로 유지한다.
  - finishStage에서 먼저 로컬 progress save를 처리하고 ranked ticket이 유효한 경우에만 result endpoint를 호출한다. 서버 승인 전에는 랭킹에 올랐다고 표시하지 않는다.
  - server 422/409/expired는 안전한 메시지를 띄우고 기존 game clear 화면을 보여준다. 사망 후 재시작은 이전 ticket을 종료하고 새 save revision/snapshot으로 ticket을 발급한다. unranked 결과는 reconnect queue에 score로 저장하지 않는다.

### I02. 클라이언트 결과·접촉 순서 검증
- Related Files:
  - test/ranked-stage-client.test.js :: deterministic scene contract — event log/ticket result; modify.
  - test/portrait-orientation.test.js :: existing orientation behavior — read-only regression.
- Details:
  - held A/D, touch direction transitions, zero direction, knockback/recontact, level-up pause, game-over retry, boss clear가 동일 tick 순서로 시뮬레이터에 들어가는지 검증한다.
  - offline play, ticket request timeout, mid-run disconnect, result 409, result 422, duplicate submit response에서 progress save는 보존되고 ranking post는 정책대로 제한되는지 검증한다.
  - stage elapsed time은 client clock이 아니라 API가 ticket issuedAtUtc와 result receiveAtUtc 차이로 반환한 값을 화면에 표시한다.

## Acceptance Criteria
- [x] online verified clear만 top-stage API에 반영된다.
- [x] offline 또는 연결 중단 run은 progress save가 남고 ranking은 변경되지 않는다.
- [x] 입력 기록 replay와 화면의 전투 결과가 동일하다.
- [x] 기존 retry, replay XP, stage unlock, portrait pause를 회귀시키지 않는다.

## Validation
    npx --yes node@22 --test test/ranked-stage-client.test.js test/portrait-orientation.test.js test/game-rules-simulation.test.js test/api/cloudSaveClient.test.js test/save/accountSaveCoordinator.test.js
    npm --prefix api test -- test/stageRuns/startStageRun.test.js test/stageRuns/submitStageResult.test.js test/stageRuns/stageRunFunctions.test.js
    npm run build

## Commit Message
    feat(ranking): record and submit verified stage runs

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P02-browser-integration
    Task: T07-ranked-stage-client

    - Run the shared combat rules at fixed 60 Hz ticks
    - Submit online input traces while preserving unranked offline play

## Progress
- [x] 구현 완료
- [x] 검증 통과: client/save/simulator/orientation 47 tests, stage-run API 12 tests, Vite build. Entra live sign-in/API and browser visual E2E remain unverified because deployment config is not set.
- commit: pending
