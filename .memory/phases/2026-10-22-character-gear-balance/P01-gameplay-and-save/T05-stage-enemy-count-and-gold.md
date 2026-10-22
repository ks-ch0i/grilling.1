# Task: T05 시드 적 수와 골드 보상

## Status: pending

## Goal
일반 적을 스테이지마다 4–10마리 배정하고, 처치/클리어 골드를 추가한다. 죽음 후 재시도에도 이미 받은 처치 골드를 유지한다.

## Decision Summary
- 일반 적 수는 균등 분포이며 ranked run은 ticket seed에서 결정한다. 일반/보스 처치 보상은 각각 11/55 gold, 성공 클리어 보상은 175 gold다.
- 이미 받은 처치 골드는 사망 시 유지한다. 클리어 보상은 clear에만 지급하며 replay clear도 정액 175를 준다.
- 골드/경험치/저장은 기존 결정대로 클라이언트 상태다. 이 task는 새 서버 권위형 통화 장부를 만들지 않는다.

## Implementation

### I01. 공유 시뮬레이터의 시드 적 수
- Related Files:
  - packages/game-rules/src/balance.js :: normalEnemyCount, goldRewards — range and payout constants; T01 output, extend.
  - packages/game-rules/src/simulation.js :: createRankedRun, createEnemy, applyStageContact — seeded count; modify.
  - src/game/scenes/BattleScene.js :: create, initializeRankedRun, spawnStage — ranked visual parity; modify.

#### Details
- Data & Schema Fields:
  - BALANCE.normalEnemyCount={min:4,max:10}.
  - BALANCE.goldRewards={normalEnemy:11,boss:55,stageClear:175}.
  - ranked state stores the selected enemy array and the post-count randomState. No separate client-only ranked count is allowed.
- Execution Flow / Logic:
  1. createRankedRun validates the v2 ticket/snapshot, calls the existing xorshift nextRandom once, sets count=4+floor(random.value*7), creates enemy-1 through enemy-N, and stores random.state as initial contact RNG state.
  2. A replay with identical ticket seed, chapter, stage, and snapshot produces identical count, enemy positions, and subsequent contact RNG stream. Do not use Math.random in packages/game-rules.
  3. BattleScene initializes the ranked simulation before creating visuals. Ranked visuals are projected from simulation enemies; the scene must not independently reroll count. Non-ranked runs select count with Math.floor(Math.random()*7)+4.
  4. Normal-defeat completion checks compare normalDefeated with state.enemies' initial normal count, not BALANCE.normalEnemyCount object identity. Boss is still spawned only after all normal enemies and only on stages divisible by 5.

### I02. 골드 보상과 재시도 수명주기
- Related Files:
  - src/game/domain/progression.js :: completeStage, retryStage — stage payout and retained gold; modify.
  - src/game/scenes/BattleScene.js :: defeatEnemy, finishStage, retry/death handlers — kill reward; modify.
  - src/game/domain/gear.js :: createInitialState — T02 v2 gold field; read-only.
  - test/stage-gold.test.js :: reward boundaries and retry behavior; new.
  - test/game-rules-simulation.test.js :: seeded enemy count and replay stream tests; modify.

#### Details
- Execution Flow / Logic:
  1. On each normal enemyDefeated event, add 11 gold exactly once. On boss defeat, add 55 gold exactly once. Do not grant gold on mere contact or a rejected/missing target.
  2. On successful completeStage, add 175 gold once per clear. Stage death does not call clear reward. Keep existing XP replay multiplier and between-stage HP minimum unchanged.
  3. retryStage restores stage/progression snapshot and full HP as before, while carrying currentState.gold so kill rewards earned in the failed attempt persist. Existing currentState.player, including its XP/points, continues to be retained.
  4. Use safe-integer checked additions. If gold would exceed Number.MAX_SAFE_INTEGER, return the existing domain failure shape without partially changing state.
  5. Ranked replay validates enemy defeats/count through the shared sim; client reward application follows the existing client-calculated progression path. Do not claim server validation of gold.

## Acceptance Criteria
- [ ] Ranked seed 1..N yields the same 4–10 enemy count and contact replay on client/server.
- [ ] Non-ranked stages draw uniformly from inclusive 4–10, with the 5th/10th stages retaining their boss.
- [ ] Each enemy pays once; failed stages preserve kill gold but pay no clear reward; clear pays 175.
- [ ] Retry preserves all current gold without duplicating or losing previous kill rewards.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/stage-gold.test.js test/game-rules-simulation.test.js — enemy count, seeded replay, reward and retry tests pass.
- npm run build — reordered BattleScene setup and enemy rendering build successfully.

## Commit Message
~~~text
feat(progression): add seeded enemy counts and gold rewards

Plan: 2026-10-22-character-gear-balance
Phase: P01-gameplay-and-save
Task: T05-stage-enemy-count-and-gold

- Seed ranked enemy counts from each run ticket
- Award kill and clear gold while retaining failed-run earnings
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
