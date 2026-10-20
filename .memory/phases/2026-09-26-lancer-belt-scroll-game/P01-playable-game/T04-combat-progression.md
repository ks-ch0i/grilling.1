# Task: T04 전투와 성장 규칙

## Status: in_progress

## Goal

순수 도메인 함수로 피해 교환, 치명타, 효과 적용, XP/레벨업, HP 회복, 단계·회차 해금을 구현해 Scene 코드가 규칙을 중복 계산하지 않게 한다.

## Decision Summary

- 계산은 Phaser 객체 없이 숫자/일반 객체만 다룬다. 접촉은 1회만 계산하며 player→enemy 결과를 먼저 적용한다.
- 진행 함수는 회차/스테이지 ID `chapter-stage`를 사용한다. 10스테이지 이후에는 다음 회차 1스테이지를 연다.

## Implementation

### I01. 피해 교환과 자동 효과

- Related Files:
  - `src/game/domain/combat.js` :: `resolveContact`, `applyGearEffects`, `rollCritical`; new
  - `src/game/data/balance.js` :: enemy defaults/effect order; read-only

#### Details
- Signatures:
  ```js
  export function rollCritical(playerStats, rng = Math.random)
  export function resolveContact({ playerStats, enemyStats, playerEffects, rng = Math.random })
  ```
- Determine critical using player critChance and rng. On critical use `playerAttack = playerStats.attack * playerStats.critMultiplier`; otherwise use base attack.
- Player-vs-enemy comparison: if effective player attack > enemy defense, raw damage to enemy is the difference; if lower, recoil damage to player is the difference; equal means 0.
- Enemy-vs-player comparison is independent: if enemy attack > player defense, raw damage to player is the difference; if lower, recoil damage to enemy is the difference; equal means 0.
- Calculate both comparisons before state mutation. Sum enemy-directed damage from both comparisons and apply to enemy HP first. If enemy HP becomes 0, return playerDamage 0. Otherwise apply the summed player-directed damage. Return `{critical,playerAttack,enemyDamage,playerDamage,enemyDefeated,playerDefeated}`; clamp each damage to nonnegative and HP to zero.
- Apply effects in this order: `bonusDamage` modifies effective player attack before enemy defense; `damageReduction` reduces player-directed damage after comparisons; `thorns` adds its value times post-reduction player-directed damage to enemy-directed damage; `lifeSteal` heals `floor(playerAttackDamage * value)` after enemy HP changes, capped at max HP. Only successful player-attack damage counts for life steal. Same effect IDs stack additively. This order is a first-version implementation default.
- Apply total enemy-directed damage first. If enemy HP reaches zero, cancel player-directed HP loss. A lethal player attack can still trigger life steal based on the actual damage applied to enemy HP.

### I02. XP, level-up, drops, stage progression

- Related Files:
  - `src/game/domain/progression.js` :: `xpRequiredForLevel`, `grantXp`, `chooseLevelUpStat`, `stageId`, `getStageEnemyStats`, `getDropWeights`, `completeStage`, `retryStage`; new
  - `src/game/data/balance.js` :: progression constants; modify

#### Details
- Signatures:
  ```js
  export function xpRequiredForLevel(targetLevel)
  export function grantXp(state, amount)
  export function chooseLevelUpStat(state, statKey)
  export function stageId(chapter, stage)
  export function getStageEnemyStats(chapter, stage, isBoss = false)
  export function getDropWeights(stageIndex)
  export function completeStage(state, chapter, stage)
  export function retryStage(stageSnapshot, currentState)
  ```
- XP start requirement is 100 for level 1→2; use the same 20%/5-level 1.5x/10-level 2x algorithm as T03 gear costs. Apply chapter-independent player level scaling and `Math.ceil`. `xp` is current-level progress; subtract each threshold on level-up, increment level, and recalculate threshold.
- XP grants are: normal enemy 10, stage clear 100, boss additional 200. Replay flag multiplies these XP rewards by 0.3 and rounds down. Loot chance does not receive the replay multiplier.
- Each gained level increments `pendingLevelUps`; the BattleScene pauses and resolves one choice at a time. `chooseLevelUpStat` accepts only `attack`, `defense`, or `maxHp`; increases +2/+5/+10, subtracts the prior XP threshold, increments level, updates xpToNext, decrements pendingLevelUps, and heals only the max-HP increase to currentHp (clamp to new maxHp).
- Stage ID uses `"${chapter}-${stage}"`; chapter starts 1, stages 1..10. Next stage increments stage; after 10, unlock next chapter stage1. Cleared stage IDs are retained to enable replay. Selecting a replay never lowers unlocked progress.
- Normal enemy base stats for the first stage are HP60/attack12/defense10. Multiply each by `(1 + 0.1*(stage-1)) * (1 + 0.5*(chapter-1))`; round HP/attack/defense up to integers. Boss multiplies result HP×5, attack×2, defense×2.
- Stage has 10 normal enemies. Every stage index divisible by 5 has a boss after normal enemies. On stage completion set currentHp to `max(currentHp,ceil(maxHp*0.5))`.
- Drop rarity probabilities linearly interpolate per within-chapter stage index between stage1 `[60,25,10,4,1]` and stage10 `[30,25,20,15,10]`, ordered common→legendary. Normal enemy gear chance 0.2; boss guarantees one item.
- `retryStage` restores gear, inventory, materials, equipment and progression to stage-entry snapshot but preserves XP, levels, and level-up stat choices already earned. HP is restored to max. This treats level-ups as a consequence of retained XP.

## Acceptance Criteria
- [x] Contact calculation implements both comparisons independently and applies enemy HP loss before player HP loss.
- [x] Critical strike is rolled only for player attack and occurs before enemy defense comparison.
- [ ] Player progression, stage/replay XP, gear drops, boss scaling, chapter unlock, and half-heal use the exact values above.
- [x] Functions validate unknown stat keys/stage numbers and return explicit errors without partially mutating state.

## Validation
- `npm run build` — domain modules compile.

## Revalidation (2026-10-20)
- Inline Node assertions passed for independent contact damage, critical-before-defense order, boss multipliers at 1-1, stage bounds, chapter-2 unlock at a prepared stage-10 state, and death-retry XP retention/reward rollback. Source review confirmed progression and invalid-input guards; build passed on Node `v20.19.4` only.
- The exact progression-values criterion remains unchecked pending the 9/28 balance-plan reconciliation: the 9/26 decision specifies 10% per stage and +0.5 per chapter, while current `balance.js` has `enemyStageGrowth: 0.2` and `chapterGrowth: 0.8`.
- Static defect found: `BattleScene.handleContacts` applies `result.playerHp` before handling `result.enemyDefeated`, so a lethal player strike still applies enemy retaliation, contrary to D03. No gameplay code was changed; combat browser scenarios remain unverified.
- Implementation commit confirmed: `3d46200 feat(game): add combat and chapter progression rules`.
- Manual gameplay validation — verify weak attack recoil, enemy defeat suppressing retaliation, critical damage before armor, max-HP level-up, replay XP, stage 5/10 boss scaling, and chapter unlock.

## Commit Message
```text
feat(game): add combat and chapter progression rules

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T04-combat-progression

- calculate contact damage, critical hits, and passive effects
- add XP, level-up, replay, and stage progression functions
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: 3d46200

