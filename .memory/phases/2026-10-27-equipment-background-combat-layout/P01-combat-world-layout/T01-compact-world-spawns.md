# Task: T01 Compact Ranked Combat World and Spawns

## Status: done

## Goal
일반 전투와 새 랭킹 티켓 v4에서 4,800px 월드, 세 개의 고정 적 군집, 뒤쪽 군집에서 500px 떨어진 보스를 사용한다. 서버 검증은 같은 배치를 재현하며, v4 전환 시 기존 v3 랭킹 티켓은 즉시 만료한다.

## Decision Summary
- 현재 4~10마리 count, 적 타입 순환, 보스 출현 조건, 보상 수치와 충돌선 `FLOOR_Y=560`은 유지한다. v4 군집 앵커는 700·1,900·3,100, 보스는 3,600이다. v3 위치 규칙은 지원 대상이 아니다.
- 사용자가 확정: 새 API 티켓은 simulatorVersion 4로 발급한다. v3 ticket은 30분 TTL을 기다리지 않고 버전 불일치 경로에서 즉시 만료·거부하며, 유효한 v4만 랭킹 재생에 사용한다. `BALANCE_VERSION=2`와 `PVP_SIMULATOR_VERSION=2`는 유지한다.

## Implementation

### I01. 버전별 stage 월드 레이아웃과 공통 스폰 계산

- Related Files:
  - `packages/game-rules/src/simulation.js` :: `STAGE_LAYOUTS`, `getStageLayout`, `getStageNormalEnemySpawnXs`, `createRankedRun`, `applyStageContact`, `stepRankedRun` — 버전별 world bounds, 적 위치와 보스 위치; modify
  - `src/game/scenes/BattleScene.js` :: `WORLD_WIDTH`, `spawnStage`, `createPlayer`, `update`, `defeatEnemy` — 일반 전투를 현재 v4 레이아웃에 맞춤; modify
  - `test/game-rules-simulation.test.js` :: ranked spawn/replay tests — v4 결과와 군집 위치 검증; modify
  - `test/game-rules-balance.test.js` :: deterministic progression expectations — 짧아진 v4 전투에 따른 기대 tick/contact 수 재기준화; modify

#### Details
- **Signatures & Types**:
  ```js
  // simulation.js exports; values are readonly by convention and returned arrays are new arrays.
  export function getStageLayout(simulatorVersion = 4) {
    // -> { worldWidth: 4800, normalEnemyClusterXs: readonly number[], bossX: 3600 }
  }
  export function getStageNormalEnemySpawnXs(enemyCount, simulatorVersion = 4) {
    // enemyCount: integer in BALANCE.normalEnemyCount [4, 10]
    // -> number[] of length enemyCount
  }
  ```
- **Data & Schema Fields**:
  - Ranked ticket remains `{runId:string, seed:number, chapter:number, stage:number, simulatorVersion:number, balanceVersion:number, issuedAtUtc:string}`. No DB/table/schema column changes.
  - `STAGE_LAYOUTS[4]`: `{worldWidth:4800, normalEnemyClusterXs:[700,1900,3100], bossX:3600}`.
  - v4 position for enemy index `i` is `normalEnemyClusterXs[Math.floor(i * 3 / enemyCount)]`. This yields balanced groups, assigning remainders front-to-back: 4 enemies → 2/1/1; 10 enemies → 4/3/3. Preserve `id=enemy-${i+1}` and existing `NORMAL_ENEMY_TYPES[i % 3]` type rotation so a cluster can contain different types.
- **Execution Flow / Logic**:
  1. Precondition & Validation: `getStageLayout` and `getStageNormalEnemySpawnXs` accept only stage simulator version 4; enemy count must be an integer within min/max. Unsupported versions and invalid counts throw `RangeError` before creating partial state.
  2. Core Processing: `createRankedRun` obtains layout from `ticket.simulatorVersion`, draws the same one seeded count value as today, uses the position helper, and stores ticket/version on state. Initialize player bounds and all stage movement/knockback clamps from that layout. When all normals are defeated on a boss stage, append the boss at layout `bossX` and emit the same `bossSpawned` event shape.
  3. Version Boundary: v4 uses the new anchors and 4,800px max x. Existing v3 tickets are rejected by the API's simulator-version mismatch path immediately after the version switch and must never reach `replayRankedRun`. `stepPvpRun` must retain its current 11,200px bound and v2 behavior; do not reuse the v4 stage bound for PvP.
  4. Client Processing: `BattleScene.spawnStage` calls `getStageNormalEnemySpawnXs(this.normalEnemyCount, 4)` for local runs; ranked runs continue creating views from `rankedRunState.enemies`. Set the scene camera bound and player movement max from the current stage layout, set `WORLD_WIDTH` to 4,800 for `drawWorld`, and use boss x 3,600 for local boss spawn. Keep `hasBoss = stage % 5 === 0` and the existing after-all-normal-defeated trigger.
  5. State Transition & Return: new v4 replay and direct play share exact enemy positions and boss x. A stored v3 ticket follows the existing immediate version-mismatch/expired-ticket response and cannot submit a result. No changes to enemy count selection, reward totals, stage clear state, or serialized enemy fields.

### I02. Stage simulator v4 issuance and immediate v3 ticket expiration

- Related Files:
  - `api/src/domain/gameVersions.js` :: `SIMULATOR_VERSION`, `SUPPORTED_STAGE_SIMULATOR_VERSIONS` — current stage version 4 and supported replay versions `[4]`; modify
  - `api/src/services/stageRunService.js` :: stage ticket creation and `submitResult` version gate — issue v4 and immediately expire/reject stored v3 tickets through the existing mismatch path; modify
  - `packages/game-rules/src/simulation.js` :: `assertTicket` and `replayRankedRun` — accept version 4 only; modify
  - `packages/game-rules/src/rewards.js` :: `validateDropTicket` — accept v4 stage reward tickets only without changing reward calculations; modify
  - `api/test/stageRuns/startStageRun.test.js` :: current ticket version contract; modify
  - `api/test/stageRuns/submitStageResult.test.js` :: v3 immediate expiry/rejection, supported v4 and unsupported-version outcomes; modify
  - `test/game-rules-simulation.test.js` :: v4 ticket validation and unsupported v3 replay rejection; modify

#### Details
- **Signatures & Types**:
  ```js
  // api/src/domain/gameVersions.js
  export const SIMULATOR_VERSION = 4;
  export const SUPPORTED_STAGE_SIMULATOR_VERSIONS = Object.freeze([4]);
  export const BALANCE_VERSION = 2;
  export const PVP_SIMULATOR_VERSION = 2;
  ```
- **Data & Schema Fields**:
  - `StageRuns.SimulatorVersion` remains the existing integer column. New rows contain 4; existing issued rows containing 3 are immediately marked/treated expired by the existing version-mismatch handling after rollout. No schema or migration change.
  - `BalanceVersion` remains 2 because enemy/player stat and reward balance data do not change. PvP simulator version remains 2 because PvP simulation rules are not changed in this Task.
- **Execution Flow / Logic**:
  1. Precondition & Validation: a submitted stage ticket is eligible only when its stored simulator version is 4 and `receivedAt < ExpiresAtUtc`; preserve existing expired-row 410 behavior and unsupported-version 409 behavior.
  2. Core Processing: issue new tickets with `SIMULATOR_VERSION=4`. `stageRunService` accepts only stored version 4. A stored v3 ticket immediately follows the existing `unsupported-simulator-version` version-mismatch path, which expires/rejects the ticket without waiting for its 30-minute TTL. Reward ticket validation accepts v4 only while retaining deterministic reward seed derivation.
  3. Error & Exception Handling: v3, v2, and future versions follow the existing unsupported-version response and expiration path. Do not broaden version acceptance to PvP tickets.
  4. State Transition & Return: valid v4 replays use the existing result transaction and canonical response contract; new ticket creation reports simulatorVersion 4. No migration is applied.

### I03. Regression coverage for layout and deterministic replay

- Related Files:
  - `test/game-rules-simulation.test.js` :: seeded enemy-count test, new cluster tests, boss spawn test, v4 replay validation tests — modify
  - `test/game-rules-balance.test.js` :: deterministic fight progression expectations — modify only values invalidated by the closer v4 positions
  - `api/test/stageRuns/startStageRun.test.js` :: issued simulatorVersion — modify
  - `api/test/stageRuns/submitStageResult.test.js` :: immediate v3 expiration/rejection and unsupported-version cases — modify

#### Details
- Cover all enemy counts 4 through 10 and assert the exact v4 position arrays, balanced group sizes, allowed identical x values, and preserved type/index sequence.
- Assert v4 boss event and stored boss enemy x are 3,600 only after every normal enemy is defeated.
- Assert same v4 ticket + snapshot + inputs replay identically; assert a v3 ticket is rejected by the pure replay validator and by the API version gate.
- Assert v4 player movement/knockback stays within `[45, 4755]`. Assert PvP v2 movement bounds remain unchanged.
- Update deterministic timing/contact expectations that change under v4; do not weaken assertions or change combat stats to make them pass.
- API tests assert new stage tickets use version 4, an issued v3 ticket is immediately expired/rejected without waiting for TTL, and unsupported versions retain the existing 409 behavior.

## Acceptance Criteria
- [ ] Local normal combat and ranked v4 simulation spawn 4–10 enemies at the same three selected anchors, distribute them evenly, and allow same-x overlap.
- [ ] Boss appears at x=3,600 after all normal enemies are defeated; world/camera/player bounds end at x=4,800 while `FLOOR_Y=560` remains unchanged.
- [ ] Stage simulator v4 is issued for new tickets; all existing v3 stage tickets are immediately expired/rejected after the version switch and cannot be replayed.
- [ ] PvP v2 rules, balance version, enemy stats, rewards, and database schema are unchanged.

## Validation
- `node --test test/game-rules-simulation.test.js test/game-rules-balance.test.js` — v4 layout, deterministic replay, unsupported v3 ticket, boss timing, and progression checks pass.
- `node --test api/test/stageRuns/startStageRun.test.js api/test/stageRuns/submitStageResult.test.js` — v4 ticket issuance and immediate v3 rejection/expiration pass.
- `npm run build` — client imports the new shared layout without bundling errors.

## Commit Message
```text
feat(combat): compact ranked stage layout

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P01-combat-world-layout
Task: T01-compact-world-spawns

- Share 4,800px world and three enemy cluster anchors
- Immediately expire/reject existing v3 ranked tickets when v4 takes effect
```

## Progress
- [x] 구현 완료
- [x] 검증 통과: game-rules 30/30, API stage-runs 20/20, Vite build, API check, `git diff --check`
- [x] commit 예정: `feat(combat): compact ranked stage layout`
