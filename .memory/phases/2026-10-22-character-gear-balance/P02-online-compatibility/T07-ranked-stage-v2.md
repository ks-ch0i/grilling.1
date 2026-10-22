# Task: T07 스테이지 랭킹 simulator/balance v2

## Status: done

## Goal
스테이지 랭킹 티켓과 입력 검증을 v2 공유 시뮬레이터 및 밸런스 규칙에 맞춘다. 기존 v1 결과는 유지하고 새 결과만 v2로 기록한다.

## Decision Summary
- 신규 stage run은 simulatorVersion=2, balanceVersion=2다. 기존 StageRuns/StageBests row는 수정하거나 새 규칙으로 재검증하지 않는다.
- 발급 당시 버전이 현재 버전과 다르거나 완료/만료 상태가 맞지 않는 진행 중 v1 티켓은 결과 제출을 통과시키지 않는다.
- 클라이언트 계산 보상과 계정 저장은 계속 서버 권위형으로 바꾸지 않는다. 서버는 전투 입력과 결과만 재생 검증한다.

## Implementation

### I01. 버전 상수와 ticket/snapshot/input 계약
- Related Files:
  - api/src/domain/gameVersions.js :: SIMULATOR_VERSION, BALANCE_VERSION — central v2 constants; new.
  - api/src/domain/stageRank.js :: version exports, validateStageInputs, buildCombatSnapshot — version2 + stat points; modify.
  - api/src/services/stageRunService.js :: create ticket and validate submitted row — use constants; modify.
  - api/src/functions/stageRuns.js :: input body validation — array-valued levelUp; modify.
  - packages/game-rules/src/simulation.js :: ticket/snapshot validation — T03/T05 output; read-only unless v2 constraints remain.
  - src/game/scenes/BattleScene.js :: ranked snapshot and event recorder — T03/T05 output; read-only unless contract mismatch.

#### Details
- Data & Schema Fields:
  - New StageRun ticket includes runId, playerId, chapter, stage, seed, simulatorVersion=2, balanceVersion=2, issuedAtUtc/expiresAtUtc and immutable combat snapshot.
  - Combat snapshot progression includes level, xp, xpToNext, pendingLevelUps, replayXpMultiplier, availableStatPoints and spentStatPoints.
  - Stage input levelUp value is an array of 0–2 stat keys. move input remains -1/0/1 and tick ordering remains strictly checked.
- Execution Flow / Logic:
  1. Define one API version module and use it from stage and PvP services. Do not leave duplicated hard-coded 1 values in ticket issuance.
  2. New tickets insert SimulatorVersion=2 and BalanceVersion=2 into existing StageRunTickets columns.
  3. stageRank validates v2 snapshot point counters and array-valued level-up events before invoking replayRankedRun.
  4. On result submission, compare stored ticket version columns with current SIMULATOR_VERSION/BALANCE_VERSION. A mismatch follows the existing invalid/stale ticket response path and never writes a StageBest.
  5. Completed v1 rows and their best records remain queryable in the same ranking list, with their persisted old version unchanged. Ranking sort and display shape remain unchanged.
  6. Keep existing ticket TTL, run ownership, one-result semantics, and elapsed-time derivation unchanged.

### I02. Stage ranking compatibility tests
- Related Files:
  - api/test/stageRuns/startStageRun.test.js :: new ticket versions and snapshot fields; modify.
  - api/test/stageRuns/submitStageResult.test.js :: v2 valid trace and stale v1 rejection; modify.
  - api/test/stageRuns/stageRunFunctions.test.js :: HTTP array validation/error status; modify.
  - test/ranked-stage-client.test.js :: v2 ticket, point snapshot, array-valued levelUp; modify.

#### Details
- Assert newly issued tickets and database inputs both use version 2.
- Assert a valid v2 trace with 0, 1, or 2 allocated keys replays identically and a string value, unknown key, three-key array, or missing required event is rejected.
- Assert seeded enemy count and RNG order agree between client replay and API service replay.
- Assert a stored v1 ticket submission is rejected without result/best mutation, while pre-existing completed v1 best rows remain returned alongside v2 results.

## Acceptance Criteria
- [x] New stage tickets/results are explicitly simulator 2 and balance 2.
- [x] Server and browser validate/replay the same stat allocation and enemy-count rules.
- [x] Stale v1 in-flight results cannot enter the v2 ranking.
- [x] Historical v1 rankings remain readable and are not recomputed.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/game-rules-simulation.test.js test/ranked-stage-client.test.js — shared/client replay contracts pass.
- npm --prefix api test — API ticket issuance, replay, stale ticket and ranking compatibility tests pass.

## Commit Message
~~~text
feat(ranking): version stage runs for balance v2

Plan: 2026-10-22-character-gear-balance
Phase: P02-online-compatibility
Task: T07-ranked-stage-v2

- Issue v2 stage tickets and validate new stat allocation inputs
- Preserve completed v1 ranking records without replaying them
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- Node.js 22.12.0: 지정 stage/client tests, 전체 루트 테스트, `npm --prefix api test`, Vite production build 통과.
- 비판적 리뷰: 새 티켓 발급을 막던 진행 중 v1 티켓을 만료 처리하고, 클라이언트도 unsupported-version 응답 뒤 대기 티켓을 정리하도록 수정했다. API 정규화 후 0/1/2개 능력치 배분 입력이 동일하게 재생되는 검증도 추가했다.
- 리뷰 후속 메모: 과거 랭킹 조회 테스트는 서비스 응답 변환을 확인하지만 SQL query를 직접 실행하지는 않는다. 랭킹 SQL은 이번 Task에서 바뀌지 않았다.
- commit: 지정 T07 커밋 메시지 사용.
