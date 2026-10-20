# Task: T04 전투와 성장 규칙

## Status: done

## Goal

순수 도메인 함수로 피해 교환, 치명타, 효과 적용, XP/레벨업, HP 회복, 단계·회차 해금을 구현해 Scene 코드가 규칙을 중복 계산하지 않게 한다.

## Decision Summary

- 계산은 Phaser 객체 없이 숫자/일반 객체만 다룬다. 접촉 시 양쪽 피해를 독립 계산하며, 적을 쓰러뜨린 접촉도 플레이어 피해를 취소하지 않는다. 플레이어가 치명 피해를 받으면 BattleScene이 처치 보상보다 먼저 사망/재도전을 처리한다 (2026-09-27 결정 D01-D03).
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
- Calculate both comparisons before state mutation. Sum damage directed to each side independently; an enemy reaching 0 HP does not suppress player-directed damage. Return `{critical,playerAttack,enemyDamage,playerDamage,enemyDefeated,playerDefeated}`; clamp each damage to nonnegative and HP to zero. `BattleScene.handleContacts` checks player defeat and routes to retry/game over before calling `defeatEnemy`, so lethal contact does not grant kill rewards (2026-09-27 decision D01-D03).
- Apply effects in this order: `bonusDamage` modifies effective player attack before enemy defense; `damageReduction` reduces player-directed damage after comparisons; `thorns` adds its value times post-reduction player-directed damage to enemy-directed damage; `lifeSteal` heals `floor(playerAttackDamage * value)` after enemy HP changes, capped at max HP. Only successful player-attack damage counts for life steal. Same effect IDs stack additively. This order is a first-version implementation default.
- Resolve the two damage amounts independently. A lethal player attack can still trigger life steal based on the actual damage applied to enemy HP; it does not cancel incoming player-directed HP loss.

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
- Normal enemy base stats for the first stage are HP60/attack12/defense10. Multiply each by `(1 + 0.20*(stage-1)) * (1 + 0.80*(chapter-1))`; round HP/attack/defense up to integers. Boss multiplies result HP×5, attack×2, defense×2. These values follow the confirmed 2026-09-28 game-balance decision D02 and supersede the original 9/26 values.
- Stage has 10 normal enemies. Every stage index divisible by 5 has a boss after normal enemies. On stage completion set currentHp to `max(currentHp,ceil(maxHp*0.5))`.
- Drop rarity probabilities linearly interpolate per within-chapter stage index between stage1 `[60,25,10,4,1]` and stage10 `[30,25,20,15,10]`, ordered common→legendary. Normal enemy gear chance 0.2; boss guarantees one item.
- `retryStage` restores gear, inventory, materials, equipment and progression to stage-entry snapshot but preserves XP, levels, and level-up stat choices already earned. HP is restored to max. This treats level-ups as a consequence of retained XP.

## Acceptance Criteria
- [x] Contact calculation resolves both damage directions independently; lethal player contact routes to retry/game over before kill rewards.
- [x] Critical strike is rolled only for player attack and occurs before enemy defense comparison.
- [x] Player progression, stage/replay XP, gear drops, boss scaling, chapter unlock, and half-heal use the confirmed values above, including the 9/28 growth formula.
- [x] Functions validate unknown stat keys/stage numbers and return explicit errors without partially mutating state.

## Validation
- `npm run build` — domain modules compile.

## Revalidation (2026-10-20)
- Isolated Chromium checks passed for weak-contact recoil (HP 100→78), critical strike before armor, and lethal contact. A lethal contact reduced player HP to 0, entered game over, and retried from the stage snapshot with HP restored while retaining XP 20 and materials 17; the dead player's kill reward was not granted.
- Gear-effect assertions passed for additive stacking and order: bonus damage, damage reduction, thorns, then life steal. The combined scenario produced attack 30, enemy damage 9, player damage 8, player HP 44, and healing 2.
- Level-up max-HP selection changed max HP 100→110 and HP 50→60. Replaying a cleared stage granted 3 XP for one normal enemy. Browser console and page errors were empty.
- Progression assertions passed for XP thresholds/rewards, 30% replay multiplier, drop weights and chance, boss drop count, 20% stage/80% chapter growth, boss scaling (stage 5: HP540/ATK44/DEF36; stage 10: HP840/ATK68/DEF56), stage-10 clear/unlock of chapter 2 stage 1, XP 400, and half-heal to HP50. Drop probing confirmed ten normal-enemy rolls before each boss.
- Production build passed with Node `22.12.0`; Vite emitted its existing advisory that the minified JavaScript chunk exceeds 500 kB. Browser scenarios used a fresh isolated profile and did not access existing saves.
- Implementation commit confirmed: `3d46200 feat(game): add combat and chapter progression rules`.
- Manual scenarios completed: weak attack recoil, lethal contact and retry ordering, critical before armor, max-HP level-up, replay XP, stage 5/10 boss scaling, and chapter unlock.

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
- [x] 검증 통과
- commit: 3d46200

