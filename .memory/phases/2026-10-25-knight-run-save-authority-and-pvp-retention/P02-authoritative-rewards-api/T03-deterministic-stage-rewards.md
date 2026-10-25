# Task: T03 결정적 스테이지 보상 규칙

## Status: done

## Goal
공유 game-rules가 검증된 stage replay의 처치·레벨업·드롭 결과만으로 동일한 보상 delta를 계산하게 한다. API는 같은 ticket/input에 항상 같은 reward JSON을 만들고 browser와 server의 보상 숫자가 갈라지지 않는다.

## Decision Summary
- 클라이언트가 보낸 보상 수량이나 아이템 JSON은 받지 않는다. 입력 로그와 ticket replay로 서버가 계산한다.
- loot randomness는 전투 simulation RNG와 분리된 ticket seed stream을 사용하고, drop ID는 RunId와 ordinal에서 결정한다.

## Implementation

### I01. 공유 simulator 결과와 reward resolver

- Related Files:
  - `packages/game-rules/src/simulation.js` :: `createRankedRun`, `stepRankedRun`, `replayRankedRun`; modify
  - `packages/game-rules/src/rewards.js` :: `resolveStageRewards`, `grantProfileXp`; new
  - `packages/game-rules/src/seededRandom.js` :: deterministic seed stream; read-only or modify only if domain-separated helper is needed
  - `packages/game-rules/src/balance.js` :: existing enemy count, XP/gold/drop/gear constants; read-only
  - `packages/game-rules/package.json` :: export `./rewards`; modify
  - `api/src/domain/stageRank.js` :: ticket snapshot progression validation; read-only unless result fields need schema guard

#### Details
- **Signatures & Types**:
  ```ts
  replayRankedRun(ticket, playerSnapshot, inputs) -> {
    valid:boolean, outcome:'clear'|'death'|'invalid'|'incomplete', elapsedTicks:number,
    playerHp:number, defeatedEnemies:Array<{id:string,isBoss:boolean}>,
    collectedDropOrdinals:number[], levelUps:Array<{allocations:string[]}>, rejectReason:string|null
  }
  resolveStageRewards({ticket, replay, profile}) -> {
    outcome:'clear'|'death', xpGranted:number, goldGranted:number,
    drops:GearItem[], profilePatch:{level,xp,xpToNext,pendingLevelUps,gold,inventory,progression}
  }
  ```
- **Data & Schema Fields**:
  - canonical profile inputs: `level`, `xp`, `xpToNext`, `pendingLevelUps`, `gold`, `materials`, `inventory`, and progression `{chapter,currentStage,unlockedChapter,unlockedStage,clearedStageIds}`.
  - deterministic rules: normal kill `BALANCE.goldRewards.normalEnemy` gold and `BALANCE.xpRewards.normalEnemy` XP; boss kill `goldRewards.boss`; clear `goldRewards.stageClear` and `xpRewards.stageClear`; clear on a boss stage adds `xpRewards.boss`. Replay XP uses snapshot `replayXpMultiplier` for every XP award.
  - normal gear drop probability `BALANCE.normalDropChance`, boss drop count `BALANCE.bossDropCount`, rarity weights from `getStageDropWeights(stage)`, gear values from current `BALANCE` templates/roll range. Materials are not directly awarded by stage completion; material changes use T05 actions.
- **Execution Flow / Logic**:
  1. Extend replay state to record defeated enemies and validated level-up events. `replayRankedRun` returns these only when the full input stream is valid and terminal outcome is clear or death.
  2. Keep loot generation deterministic and separate from combat RNG: derive a nonzero uint32 from `(ticket.seed, 'stage-rewards')`; roll one normal-drop chance per defeated normal enemy and guaranteed boss drops only when the replay rules say the player survives the boss defeat.
  3. Track dropped ordinals and whether the replay player collected each drop at the same 45-pixel range used by `BattleScene.collectDrops`. Do not accept client item JSON. Generate IDs as `${ticket.runId}:drop:${ordinal}`.
  4. Award XP and gold for validated defeated enemies. Add clear rewards and append the stage ID/unlock next stage only for outcome `clear`; `death` never unlocks or receives stage-clear bonus.
  5. Compute XP thresholds with the existing `xpRequiredForLevel` curve. Apply only the number and valid allocation keys in replay `levelUps`; increment canonical level, decrement pending count, and update `xpToNext` from the final level. Keep client-owned baseStats/allocation effects out of `profilePatch`.
  6. Reject invalid state, unsafe integer overflow, invalid ticket seed, or unknown balance shape with a typed `StageRewardError` code; caller must not persist partial profile changes.
- **Error & Exception Handling**: `StageRewardError` codes are `invalid-profile`, `invalid-replay`, `reward-overflow`, `invalid-stage`. A replay with `valid:false` is not passed to the resolver. Resolver is pure and does not mutate its inputs.
- **State Transition & Return**: same `ticket + replay + profile` yields byte-stable reward JSON; `profilePatch` contains only server-owned fields. This Task does not persist it.

### I02. Shared rule tests

- Related Files:
  - `test/game-rules-rewards.test.js` :: new reward rule cases
  - `test/game-rules-simulation.test.js` :: replay event result assertions; modify
  - `packages/game-rules/package.json` :: export tests resolve `@knight-run/game-rules/rewards`; verify

#### Details
- Cover normal/boss/clear/replay XP and gold, replay level-up events, stage 10 rollover, already-cleared replay, death without clear grant, deterministic loot across repeated calls, pickup range, full inventory capacity, and overflow rejection.
- Prove invalid/incomplete replay cannot be passed as a successful reward outcome.

## Acceptance Criteria
- [x] Shared resolver never accepts client-calculated reward fields.
- [x] Same ticket/replay/profile yields identical drops and profile delta.
- [x] Clear and death grants differ exactly by stage-clear bonus and progression unlock.
- [x] Existing simulation outcome and timing tests remain valid.

## Validation
- `node --test test/game-rules-rewards.test.js test/game-rules-simulation.test.js` (workdir: repository root) — focused shared rules tests pass
- `npm test` (workdir: repository root) — root suite passes
- `npm run build` (workdir: repository root) — Vite production build resolves the new package export

## Commit Message
```text
feat(game-rules): resolve deterministic verified stage rewards

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P02-authoritative-rewards-api
Task: T03-deterministic-stage-rewards

- Derive XP, gold, drops and progression from replay events
- Keep reward generation deterministic across browser and API
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- Validation: focused shared-rules tests 34 passed; root suite 173 passed; Vite build passed with a Phaser chunk-size warning.
- commit: pending
