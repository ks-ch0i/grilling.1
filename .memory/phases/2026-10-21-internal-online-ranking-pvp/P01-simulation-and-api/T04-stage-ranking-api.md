# Task: T04 스테이지 랭킹 API

## Status: done

## Goal
온라인 스테이지 실행 티켓을 발급하고 제출된 입력을 서버에서 재생해 검증된 최고 스테이지·최고 시간을 저장한다.

## Decision Summary
- 랭킹은 server-issued ticket, seed, immutable start stat snapshot, input replay를 요구한다.
- server elapsed time은 티켓 발급 시각부터 result 요청 수신 시각까지이며 클라이언트가 보낸 시간은 사용하지 않는다. 네트워크 왕복시간이 기록에 반영된다.
- 오프라인 클리어는 이 API를 호출하지 않으며 랭킹을 갱신하지 않는다.

## Implementation

### I01. 실행 티켓
- Related Files:
  - api/src/services/stageRunService.js :: startStageRun — 권한·스테이지 검증과 ticket 저장; new.
  - api/src/functions/stageRuns.js :: POST /api/stage-runs — 티켓 발급; new.
  - api/src/domain/stageRank.js :: derivePlayerCombatSnapshot, validateStageInputs, compareStageRank — snapshot, input and order rules; new.
  - api/src/repositories/stageRankingRepository.js :: createTicket, completeRun, getTopFive — SQL transactions; new.
  - api/src/functions/rankings.js :: GET /api/rankings/stage/top — top-five endpoint; new.
  - api/test/stageRuns/startStageRun.test.js :: ticket validation; new.
- Details:
  - POST body: { chapter: integer >= 1, stage: integer 1..10, expectedSaveRevision: integer }.
  - 서버는 CloudSaves revision과 expectedSaveRevision이 같은지 확인하고, 시작 전 cloud save에서 derivePlayerStats를 계산해 PlayerCombatSnapshot을 만든다. 데이터 자체는 클라이언트 제출이므로 치트 불가능하다고 간주하지 않는다.
  - 새 ticket의 chapter/stage는 cloud progression의 unlocked stage 또는 cleared stage 이하여야 한다. 서버는 stage 진행 데이터를 권위형으로 승격하지 않는다.
  - RunTicket: runId(UUID), playerId, seed(crypto random 32-bit nonzero), chapter, stage, simulatorVersion=1, balanceVersion, playerSnapshotJson, issuedAtUtc, expiresAtUtc=issuedAtUtc+30 minutes, status='issued'.
  - 계정당 동시에 유효한 stage ticket은 하나만 허용한다. 이전 만료 ticket은 결과 저장 없이 expired 처리한다.
  - 실행 티켓은 인증 필수, 저장 revision mismatch는 409, 허용하지 않은 stage는 403, 동시 ticket은 409를 반환한다.

### I02. 재생 검증 및 최고 기록
- Related Files:
  - api/src/services/stageRunService.js :: submitStageResult — idempotent replay; modify.
  - api/src/repositories/stageRankingRepository.js :: completeRun, getTopFive — SQL transactions; new.
  - api/src/functions/stageRuns.js :: POST /api/stage-runs/{runId}/result — 결과 제출; modify.
  - api/test/stageRuns/submitStageResult.test.js, stageRunFunctions.test.js, api/test-support/stageRuns.js :: replay and HTTP fixtures; new.
  - api/test/stageRuns/submitStageResult.test.js :: replay/rank ordering; new.
- Details:
  - Result body는 { inputs: RunInputEvent[] }만 받는다. clientWon, elapsedMs, playerHp, rating, snapshot 필드는 unknown-field 검증 후 거부한다.
  - runId 소유자, issued 상태, expiresAtUtc, simulatorVersion, event 개수 상한 100,000, body 1 MiB 상한을 확인한다.
  - replayRankedRun이 clear가 아니면 result를 ranked 처리하지 않고 422 code='run-not-cleared'를 반환한다. 유효 clear는 server의 receiveAtUtc를 완료 시각으로 기록한다.
  - ClearTimeMs = receiveAtUtc - issuedAtUtc. 음수·만료·server replay elapsedTicks가 server elapsed 시간보다 큰 비현실적 입력은 거부한다. 한 번 완료한 ticket의 동일 요청 재시도는 저장된 결과를 반환하고 다른 payload 재사용은 409다.
  - StageBests 비교: chapter*10+stage가 더 높으면 교체, 같으면 ClearTimeMs가 더 짧을 때만 교체. 플레이어당 한 row를 유지한다. 첫 verified clear가 row를 생성한다.
  - GET top은 StageOrdinal DESC, ClearTimeMs ASC, PlayerId ASC 순으로 5개만 반환한다. 응답에는 displayName, chapter, stage, clearTimeMs, rank만 포함한다.
  - 최고 기록 변경 시 SignalR publish용 RankingChanged event를 내보내고 동일 값이면 publish하지 않는다.

## Acceptance Criteria
- [x] 티켓은 서버 시드와 현재 cloud save 기반 스탯을 고정한다.
- [x] 서버가 clear를 재현하지 못하는 조작 payload는 StageBests를 바꾸지 않는다.
- [x] cloud progression은 고치지 않고 랭킹 전용 row만 원자적으로 갱신한다.
- [x] 동일 계정 재시도는 중복 기록/푸시를 생성하지 않는다.

## Validation
    npm --prefix api test -- test/stageRuns/startStageRun.test.js test/stageRuns/submitStageResult.test.js test/stageRuns/stageRunFunctions.test.js
    npx --yes node@22 --test test/game-rules-simulation.test.js

## Commit Message
    feat(api): validate stage runs and maintain leaderboard

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P01-simulation-and-api
    Task: T04-stage-ranking-api

    - Issue seeded stage tickets and replay submitted inputs
    - Persist verified best stage times and expose top five

## Progress
- [x] 구현 완료
- [x] 검증 통과: stage-run 12 tests; API 40 tests and simulator 14 tests on Node 22; npm run build; API syntax checks.
- commit: 49a9a6c
