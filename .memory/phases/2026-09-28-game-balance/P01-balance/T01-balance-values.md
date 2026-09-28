# Task: T01 Balance Values and Enemy Progression

## Status: done

## Goal
Update the life-steal rarity values and enemy growth constants so newly rolled eligible gear uses the confirmed lower healing values and enemies scale by 20% per stage and 80% per chapter. Preserve the existing enemy-stat and boss calculations.

## Decision Summary
- Life-steal values in common/uncommon/rare/unique/legendary order: `0`, `0`, `0.01`, `0.03`, `0.05`.
- Set stage growth to `0.20` and chapter growth to `0.80`; keep the multiplicative formula and current saved equipment unchanged.
- Source decision: [2026-09-28-game-balance.md](../../../decisions/2026-09-28-game-balance.md).

## Implementation

### I01. Update centralized balance values

- Related Files:
  - `src/game/data/balance.js` :: `BALANCE.enemyStageGrowth` and `BALANCE.chapterGrowth` - update the progression multipliers; modify.
  - `src/game/data/balance.js` :: `BALANCE.effectValues.lifeSteal` - set the rarity table; modify.
  - `src/game/domain/gear.js` :: `rollEffects` - read-only; preserve the rule that only unique and legendary gear roll effects.
  - `src/game/domain/saveStore.js` :: `loadGameState` - read-only; preserve existing saved equipment values without migration.

#### Details
- **Signatures & Types**:
  - Keep `BALANCE` as the existing frozen object. Change only the numeric values named here.
  - `getStageEnemyStats(chapter: number, stage: number, isBoss?: boolean)` keeps its current signature and return shape.
- **Data & Schema Fields**:
  - `BALANCE.enemyStageGrowth: number = 0.20`.
  - `BALANCE.chapterGrowth: number = 0.80`.
  - `BALANCE.effectValues.lifeSteal: { common: number, uncommon: number, rare: number, unique: number, legendary: number } = { common: 0, uncommon: 0, rare: 0.01, unique: 0.03, legendary: 0.05 }`.
  - Do not change `schemaVersion`, `SAVE_KEY`, equipment item fields, or other effect tables.
- **Execution Flow / Logic**:
  1. Keep normal enemy growth as `(1 + BALANCE.enemyStageGrowth * (stage - 1)) * (1 + BALANCE.chapterGrowth * (chapter - 1))`.
  2. Keep the existing `Math.ceil` conversion for enemy HP, attack, and defense, and keep boss multipliers applied after normal enemy growth.
  3. `rollEffects` continues to give no effects to common/uncommon/rare gear. Unique and legendary life-steal drops read the new `0.03` and `0.05` values.
  4. Do not rewrite or normalize any existing save. Existing saved life-steal effect values remain as stored.

### I02. Verify balance formulas with focused assertions

- Related Files:
  - No new test file; validate exported functions and constants directly with Node.js.

#### Details
- Import `node:assert/strict`, `BALANCE` from `src/game/data/balance.js`, and `getStageEnemyStats` from `src/game/domain/progression.js`.
- Assert life-steal values in rarity order are `[0, 0, 0.01, 0.03, 0.05]`.
- Assert `getStageEnemyStats(1, 1)` is `{ maxHp: 60, hp: 60, currentHp: 60, attack: 12, defense: 10, isBoss: false }`.
- Assert `getStageEnemyStats(1, 10)` gives max HP `168`, attack `34`, and defense `28`.
- Assert `getStageEnemyStats(2, 1)` gives max HP `108`, attack `22`, and defense `18`.
- Assert `getStageEnemyStats(1, 1, true)` gives max HP `300`, attack `24`, and defense `20`.

## Acceptance Criteria
- [ ] The five life-steal table entries equal 0, 0, 0.01, 0.03, and 0.05 in rarity order.
- [ ] Stage and chapter growth constants are 0.20 and 0.80, and the current multiplicative formula is preserved.
- [ ] Normal and boss enemy values match the listed focused assertions.
- [ ] Existing save data and effect-generation eligibility are unchanged.

## Validation
- `node --input-type=module -e "import assert from 'node:assert/strict'; import { BALANCE } from './src/game/data/balance.js'; import { getStageEnemyStats } from './src/game/domain/progression.js'; assert.deepEqual(Object.values(BALANCE.effectValues.lifeSteal), [0, 0, 0.01, 0.03, 0.05]); assert.deepEqual(getStageEnemyStats(1, 1), {maxHp:60,hp:60,currentHp:60,attack:12,defense:10,isBoss:false}); for (const [chapter,stage,hp,attack,defense] of [[1,10,168,34,28],[2,1,108,22,18]]) { const e=getStageEnemyStats(chapter,stage); assert.equal(e.maxHp,hp); assert.equal(e.attack,attack); assert.equal(e.defense,defense); } const b=getStageEnemyStats(1,1,true); assert.equal(b.maxHp,300); assert.equal(b.attack,24); assert.equal(b.defense,20);"` - all focused assertions pass.
- `npm.cmd run build` - Vite production build succeeds.

## Commit Message
```text
feat(balance): tune life steal and enemy growth

Plan: 2026-09-28-game-balance
Phase: P01-balance
Task: T01-balance-values

- Lower life-steal effect values by rarity.
- Increase stage and chapter enemy growth.
```

## Progress
- [x] Implementation complete
- [x] Validation passed
- commit: pending
