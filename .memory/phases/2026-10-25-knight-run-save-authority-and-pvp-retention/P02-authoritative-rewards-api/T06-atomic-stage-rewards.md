# Task: T06 검증 스테이지 보상 원자 지급

## Status: pending

## Goal
검증된 clear/death replay에 대해 보상 계산, stage ticket terminal 전이, leaderboard 갱신, reward profile과 merged CloudSave 변경을 하나의 transaction으로 처리한다. 동일 RunId/input 재시도는 저장된 결과를 반환하고 보상을 중복 지급하지 않는다.

## Decision Summary
- valid death는 처치 보상만 받고 스테이지 clear 보상/해금은 받지 않는다. invalid, incomplete, expired run에는 보상을 지급하지 않는다.
- ticket issuance의 CloudSave snapshot revision은 전투 시작 검증에 쓰고, completion 때는 최신 profile을 잠가 그 위에 delta를 적용한다.

## Implementation

### I01. Stage service/repository 통합

- Related Files:
  - `api/src/services/stageRunService.js` :: `startStageRun`, `submitStageResult`, `conflictForStoredResult`, `resultFromCompletion`; modify
  - `api/src/repositories/stageRankingRepository.js` :: `createTicket`, `completeRun`, ticket row columns; modify
  - `api/src/repositories/playerProfileRepository.js` :: profile/save transaction methods from T04; read/write
  - `packages/game-rules/src/rewards.js` :: `resolveStageRewards`; use
  - `api/migrations/007-stage-result-reward-persistence.sql` :: add the result columns used by the repository; new

#### Details
- **Signatures & Types**:
  ```js
  submitStageResult(pool, identity, runId, body, receivedAtUtc, dependencies) -> Promise<{
    status:200, verified:true, outcome:'clear'|'death', clearTimeMs:number|null,
    bestChanged:boolean, revision:number, state:GameStateV2, rewards:RewardSummary
  }|{status:number,code:string,...}>
  completeRun(transaction, {playerId,runId,inputJson,outcome,completedAtUtc,clearTimeMs,rewardJson})
    -> Promise<{kind:'completed'|'rejected'|'expired'|'not-found',row,reward?:object,bestChanged?:boolean,topFive?:object[]}>
  ```
- **Data & Schema Fields**:
  - Add `StageRunTickets.InputJson nvarchar(max) NULL`, `Outcome nvarchar(16) NULL`, and `RewardJson nvarchar(max) NULL`. The repository already reads/writes the first two fields, but migrations 001–003 do not create them; this migration closes that schema gap as well as storing the reward receipt.
  - `RewardJson` contains the public reward summary; latest merged profile state is reread for retries so the response cannot return stale state.
  - `Status='completed'` for valid clear or death replay; `Outcome` stores `clear`/`death`. Invalid replay remains rejected. StageBests changes only on `clear`.
- **Execution Flow / Logic**:
  1. In migration 007, add nullable `InputJson`, `Outcome`, and `RewardJson` to `StageRunTickets`; constrain non-null Outcome to `clear|death|invalid|incomplete`, record version 7, and leave old terminal rows with NULL result columns (they remain non-rewardable).
  2. Preserve existing request validation, ticket ownership, expiry, simulator/balance version, replay input and clear-time checks.
  3. For valid clear/death call shared `resolveStageRewards` using the currently locked server profile and replay diagnostics. Do not calculate reward from request body fields.
  4. Inside `completeRun`, lock player, ticket, CloudSave and profile. If ticket is already terminal, compare stored input JSON and return stored RewardJson plus the latest merged profile/revision; different input returns existing 409.
  5. For a new valid result, merge `profilePatch` into current profile, update `CloudSaves` merged save/revision, store ticket input/outcome/completed time/reward JSON, and update StageBests for clear only. All writes commit or rollback together.
  6. Return stored reward receipt and current merged state. Publish ranking-change events only after commit and only when a clear changes best. Event failure cannot undo reward persistence.
  7. Publish verified death with `bestChanged:false`, `clearTimeMs:null`; no stage unlock and no clear bonuses. `run-expired`, unsupported version, invalid/incomplete replay keep current error codes and no reward write.
- **Error & Exception Handling**: profile missing/corrupt and SQL failures rollback. Overflow from T03 maps to 422 `reward-overflow`; service must not mark ticket completed. After a successful commit, notification errors are swallowed as current ranking path does.
- **State Transition & Return**: CloudSave.Revision increments once on reward application. Duplicate same input returns the stored reward receipt and current merged state without a second increment.

### I02. Stage API tests

- Related Files:
  - `api/test/stageRuns/submitStageResult.test.js` :: verified reward results, death, invalid, retry; modify
  - `api/test/stageRuns/startStageRun.test.js` :: canonical profile snapshot and locked progression; modify
  - `api/test/stageRuns/stageRunFunctions.test.js` :: public DTO/status mapping; modify
  - `api/test/database/schema-contract.test.js` :: StageRunTickets migration contract; modify

#### Details
- Verify clear awards all expected fields once and updates best; death awards only replayed kill rewards; invalid/incomplete gets no changes.
- Concurrent same ticket submissions serialize; same input returns identical RewardJson and revision; different input is 409.
- SQL failure at profile, CloudSave, ticket, or StageBest write rolls back all writes.
- A CloudSave client write during the battle does not cause old client data to replace the latest profile; reward delta applies to the locked current canonical profile.

## Acceptance Criteria
- [ ] Server computes and transactionally applies rewards only after valid replay.
- [ ] Clear and death reward semantics match the shared resolver contract.
- [ ] Run result and profile grant are idempotent under retries and concurrent submissions; retries do not return stale profile state or increment revision again.
- [ ] Public response includes merged state/revision needed by the client to install canonical progress.

## Validation
- `node --test test/stageRuns/submitStageResult.test.js test/stageRuns/startStageRun.test.js test/stageRuns/stageRunFunctions.test.js` (workdir: `api`) — focused stage tests pass
- `npm test` (workdir: `api`) — API suite passes
- `npm run check` (workdir: `api`) — Function entry parses

## Commit Message
```text
feat(api): grant verified stage rewards atomically

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P02-authoritative-rewards-api
Task: T06-atomic-stage-rewards

- Apply replay-derived rewards with stage result in one transaction
- Persist idempotent result envelopes for safe retries
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
