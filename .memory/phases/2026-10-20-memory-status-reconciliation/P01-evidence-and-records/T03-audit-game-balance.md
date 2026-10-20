# Task: T03 Audit Game Balance Plan

## Status: done

## Goal

Recheck the 9/28 life-steal/enemy-growth values, additive upgrade behavior, and town feedback, then reconcile the original three task records and their parent plan.

## Decision Summary

- The original T01–T03 `done` statuses are not proof by themselves. Re-run the listed assertions and inspect/browser-check the town feedback.
- The original T03 notes that browser visual inspection was unavailable. Keep that criterion unchecked unless a current browser check succeeds.
- Candidate implementation commits are T01 `7f89d05`, T02 `4f9a8f4`, and T03 `6025bfd`; confirm each Git subject before recording it.

## Implementation

### Data & Schema Fields

- No game-state, save, or gameplay schema changes are allowed.
- The historical task record fields are `Status` (`done` or `in_progress`), acceptance checkbox booleans, validation text, and a confirmed implementation `commit` hash or `pending`. The phase count is `done: integer/3`; the parent plan is `done` only when all three task records are done.

### I01. Verify balance values and enemy growth

- Related Files:
  - `src/game/data/balance.js` :: `BALANCE.effectValues.lifeSteal`, `enemyStageGrowth`, `chapterGrowth`; read-only.
  - `src/game/domain/progression.js` :: `getStageEnemyStats`; read-only.
  - `.memory/phases/2026-09-28-game-balance/P01-balance/T01-balance-values.md` :: criteria, validation, status, commit; modify.

#### Details

- Run:

  ```powershell
  node --input-type=module -e "import assert from 'node:assert/strict'; import { BALANCE } from './src/game/data/balance.js'; import { getStageEnemyStats } from './src/game/domain/progression.js'; assert.deepEqual(Object.values(BALANCE.effectValues.lifeSteal), [0, 0, 0.01, 0.03, 0.05]); assert.equal(BALANCE.enemyStageGrowth, 0.2); assert.equal(BALANCE.chapterGrowth, 0.8); assert.deepEqual(getStageEnemyStats(1, 1), {maxHp:60,hp:60,currentHp:60,attack:12,defense:10,isBoss:false}); for (const [chapter,stage,hp,attack,defense] of [[1,10,168,34,28],[2,1,108,22,18]]) { const e=getStageEnemyStats(chapter,stage); assert.equal(e.maxHp,hp); assert.equal(e.attack,attack); assert.equal(e.defense,defense); } const b=getStageEnemyStats(1,1,true); assert.equal(b.maxHp,300); assert.equal(b.attack,24); assert.equal(b.defense,20);"
  ```

- Inspect `gear.js:rollEffects` to confirm effects remain eligible only for unique/legendary gear, and inspect save loading to confirm old saved effect values are not rewritten.

### I02. Verify deterministic upgrade outcomes and caps

- Related Files:
  - `src/game/data/balance.js` :: `BALANCE.gearUpgrade`; read-only.
  - `src/game/domain/gear.js` :: `upgradeGear`, `getGearUpgradeCost`, `applyUpgrade` helpers; read-only.
  - `src/game/domain/combat.js` :: `applyGearEffects`, `resolveContact`; read-only.
  - `.memory/phases/2026-09-28-game-balance/P01-balance/T02-enhancement-resolution.md` :: criteria, validation, status, commit; modify.

#### Details

- Re-run the exact deterministic ordinary-stat/great-success command in that original T02 `Validation` section. Expected results: attack 10 becomes 11 on the ordinary minimum roll or 12 on great success; level increases once; materials decrease by `getGearUpgradeCost(1)`; `greatSuccess` matches the first injected RNG draw.
- Run the original T02 I03 unique-item `effect-only` injected-RNG case: a life-steal value of `0.03` becomes `0.031` on normal success and `0.032` on great success.
- Use a unique helmet with one `lifeSteal` effect at `0.03` and `materials: 1000`; inject RNG `[0.5,0.5,0,0]` for normal success and `[0,0.5,0,0]` for great success. Assert `result.ok === true`, effect values `0.031`/`0.032`, one level increase, materials reduced by `getGearUpgradeCost(1)`, and the item remains in `equipment.helmet`.
- Verify the original T02 cap assertions: critical chance cannot exceed 1; two 0.8 damage-reduction effects sum to 1.6 in `applyGearEffects`; `resolveContact` caps reduction at 1 and results in zero incoming damage.
- Inspect ordinary/special ranges, six-decimal precision, one 5% great-success roll per valid paid upgrade, unchanged failure return shapes, and unchanged save schema. Do not alter code or add tests.

### I03. Verify town upgrade guidance and browser feedback

- Related Files:
  - `src/game/scenes/TownScene.js` :: `TownScene.init`, upgrade button callback, `renderSelectedItem`; read-only.
  - `src/game/domain/saveStore.js` :: `saveGameState`, `loadGameState`; read-only.
  - `.memory/phases/2026-09-28-game-balance/P01-balance/T03-town-feedback.md` :: criteria, validation, status, commit; modify.

#### Details

- Run `node --check src/game/scenes/TownScene.js` and source assertions that help text distinguishes ordinary and special stats, uses the exact message `강화 대성공!`, scopes the message to the upgraded item ID, and shows no numeric gain.
- In the isolated browser profile, select both equipped and inventory gear; check guidance layout and no overlap; verify normal/failed upgrades clear feedback, a forced/stubbed great-success result shows the message only for the matching selected item, item selection hides it, and level/material/equipment persistence still works.
- Start the app for the browser scenario with `npm run dev -- --host 127.0.0.1 --port 4175 --strictPort`; use browser DevTools to pause on the upgrade callback and set the returned result object's `greatSuccess` field to `true` before the rendering branch. Do not edit source files to force the outcome.
- Verify an existing 12% life-steal save value round-trips without migration. Do not clear or overwrite existing save data.
- If browser visual inspection remains unavailable, explicitly record that result, leave the associated criterion unchecked, and keep T03, its phase, and its parent plan incomplete.
- Run `npm run build` under Node 20.19.4 and record the declared engine mismatch and any bundle warning.
- Confirm commit subjects with `git show --no-patch --format="%h %s" <hash>` for each of `7f89d05`, `4f9a8f4`, and `6025bfd` before writing the old commit fields.

## Acceptance Criteria

- [x] Original T01 value/formula assertions pass and save/effect eligibility behavior remains intact.
- [x] Original T02 deterministic upgrade, additive range, great-success, cap, return-shape, and schema checks pass.
- [x] Original T03 source, save-round-trip, and browser feedback/layout checks have individual recorded results.
- [x] Any unavailable required visual check remains unchecked and keeps its Task/phase/plan incomplete.
- [x] The original balance phase count, parent plan status, validation notes, and confirmed commit references agree.
- [x] No gameplay source or existing save data is modified.

## Validation

- The Node assertions in I01 — expected exit code 0.
- Original T02 ordinary-stat, unique `lifeSteal`, critical-cap, and damage-reduction-cap assertions — expected exit code 0.
- `node --check src/game/scenes/TownScene.js` — expected exit code 0.
- `npm run build` — record result under Node `20.19.4`; this is below the declared `>=22.12.0` engine.
- Isolated browser town feedback checks — record each visible behavior or exact reason unavailable.
- `git show --no-patch --format="%h %s" <hash>` — confirm each implementation commit subject.

## Commit Message

```text
docs(memory): reconcile balance verification records

Plan: 2026-10-20-memory-status-reconciliation
Phase: P01-evidence-and-records
Task: T03-audit-game-balance

- recheck balance, upgrade, and town feedback evidence
- align original task and phase status with verified criteria
```

## Progress

- [x] Audit complete
- [x] Validation recorded
- commit: pending
