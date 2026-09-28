# Task: T02 Enhancement Resolution

## Status: done

## Goal
Keep ordinary max HP, attack, and defense upgrades unchanged; use the confirmed additive ranges for special stats and effects; and add a 5% great-success outcome that doubles the increase rolled for the selected option or options.

## Decision Summary
- Ordinary integer stats retain the current 1%–5% multiplicative growth followed by ceiling.
- Special values add a random increment from their own range. Percentage-point increments are represented as decimal fractions in stored values.
- Great success occurs with probability 5% per valid paid upgrade and doubles each rolled increment. Upgrade cost and success guarantees do not change.
- Preserve existing saved values and save schema. Existing gear uses the new formula only when upgraded after this change.
- Source decision: [2026-09-28-game-balance.md](../../../decisions/2026-09-28-game-balance.md).

## Implementation

### I01. Define upgrade balance data

- Related Files:
  - `src/game/data/balance.js` :: `BALANCE.gearUpgrade` - define centralized ordinary/special ranges and great-success chance; modify.

#### Details
- **Signatures & Types**:
  - Add frozen numeric records under `BALANCE.gearUpgrade`:
    - `ordinaryIncrease: { min: 0.01, max: 0.05 }`.
    - `greatSuccessChance: 0.05`.
    - `specialIncrease` keyed by the existing exact stat/effect IDs below, each `{ min: number, max: number }`.
- **Data & Schema Fields**:

| Key | Min | Max | Unit in stored value |
| --- | ---: | ---: | --- |
| `critChance` | 0.001 | 0.01 | 0.1–1 percentage point |
| `critMultiplier` | 0.01 | 0.1 | x multiplier |
| `moveSpeedPercent` | 0.01 | 0.05 | 1–5 percentage points |
| `bonusDamage` | 0.01 | 0.05 | 1–5 percentage points |
| `damageReduction` | 0.001 | 0.01 | 0.1–1 percentage point |
| `lifeSteal` | 0.001 | 0.01 | 0.1–1 percentage point |
| `thorns` | 0.01 | 0.03 | 1–3 percentage points |

- Do not change rarity base values except the life-steal values already handled in T01. Do not add item fields or alter the save schema.

### I02. Resolve ordinary and special increases with great success

- Related Files:
  - `src/game/domain/gear.js` :: `improveValue` - replace the one-size-fits-all behavior with ordinary-stat and special-stat calculations; modify.
  - `src/game/domain/gear.js` :: `upgradeItem` - select the existing target(s), apply per-key increments, and return the upgraded item; modify.
  - `src/game/domain/gear.js` :: `upgradeGear` - roll great success after validation and expose its outcome; modify.
  - `src/game/domain/gear.js` :: `getGearUpgradeCost`, `derivePlayerStats`, `tryStoreDrop` - read-only; preserve behavior.
  - `src/game/domain/combat.js` :: `applyGearEffects` and `resolveContact` - read-only; preserve raw effect aggregation and the 100% damage-reduction cap at contact resolution.

#### Details
- **Signatures & Types**:
  - Keep `upgradeGear(state, itemId, rng = Math.random)` and its existing failure results unchanged.
  - On success, preserve `{ ok: true, state, cost, item }` and add `greatSuccess: boolean`.
  - Keep `upgradeItem(item, rng, greatSuccess)` private. It returns a gear item with the existing `id`, `slot`, `rarity`, `level`, `stats`, and `effects` fields; do not persist great-success state on the item.
- **Data & Schema Fields**:
  - Ordinary stats are exactly `maxHp`, `attack`, and `defense`.
  - Special gear stats are `critChance`, `critMultiplier`, and `moveSpeedPercent`.
  - Special effects are `bonusDamage`, `lifeSteal`, `damageReduction`, and `thorns`.
  - Keep item level integer and capped at `BALANCE.gearMaxLevel`; keep the existing material cost and inventory/equipment storage location.
- **Execution Flow / Logic**:
  1. Locate the item and validate item existence, max level, and material sufficiency before consuming RNG. Failed attempts keep their existing return objects and consume no RNG.
  2. For a valid paid attempt, draw one great-success roll: `greatSuccess = rng() < BALANCE.gearUpgrade.greatSuccessChance`.
  3. Preserve the existing target mode: common/uncommon/rare select `stat-only`; unique/legendary select uniformly from `stat-only`, `effect-only`, and `both`. In each selected category, choose one existing stat/effect uniformly. In `both`, resolve both targets independently.
  4. For an ordinary stat, draw `rate = min + rng() * (max - min)` from `ordinaryIncrease`; calculate `normalValue = ceil(oldValue * (1 + rate))`, then calculate `gain = normalValue - oldValue`. Set the result to `oldValue + gain * (greatSuccess ? 2 : 1)`. This preserves ordinary rounding and makes great success double the actual integer increase.
  5. For a special stat or effect, draw its own increment from `specialIncrease`, multiply that increment by two only on great success, and add it to the old value. Round the resulting stored number to six decimal places.
  6. Keep the critical-chance cap at `BALANCE.critChanceCap` (1.0). `applyGearEffects` continues to return the raw sum of effects; keep the existing total damage-reduction cap in `resolveContact` in `combat.js`. Do not add caps to the other special values.
  7. Increment gear level exactly once, deduct the existing cost exactly once, and preserve equipment/inventory location. On success return the `greatSuccess` boolean; only report `true` when the great-success roll passed.
  8. Do not rewrite saved equipment on load. Future upgrades of old saved gear use the new per-key ranges; their current values remain untouched until upgraded.
- **Error & Exception Handling**:
  - Preserve existing reasons `item-not-found`, `max-level`, and `insufficient-materials`, including the existing `cost` field on insufficient materials.
  - Do not change ordinary guaranteed-success behavior or allow a great-success roll to spend extra materials.

### I03. Verify upgrade outcomes with injected RNG

- Related Files:
  - No new test file; use `node:assert/strict` with `upgradeGear` and deterministic RNG values.

#### Details
- Verify a common item with one ordinary stat, old value `10`, and sufficient materials: RNG `[0.5, 0, 0, 0]` produces no great success and a minimum 1% roll, resulting in `11`; RNG `[0, 0, 0, 0]` produces great success and the same roll, resulting in `12`.
- Verify a unique item in `effect-only` mode with one `lifeSteal` effect at `0.03`: choose mode index 1 with RNG `0.5`, choose the sole effect with `0`, and roll the minimum increase with `0`. A non-great-success result becomes `0.031`; a great-success result becomes `0.032`.
- In both successful cases assert level advances once, materials decrease by exactly `getGearUpgradeCost(oldLevel)`, item location remains unchanged, and returned `greatSuccess` matches the first RNG draw.
- Verify critical chance remains at or below 1 after a large additive increment. Verify `applyGearEffects` returns an uncapped sum of 1.6 for two 0.8 damage-reduction effects and `resolveContact` applies the existing cap so player damage is zero.

## Acceptance Criteria
- [ ] Ordinary stats still use a 1%–5% roll and ceiling; great success doubles the actual resulting integer gain.
- [ ] Each of the seven special values uses its own additive range and six-decimal storage precision.
- [ ] Great success is rolled once at 5%, doubles each selected increase, and does not change cost or level count.
- [ ] Critical chance and total damage reduction retain their existing caps; no new save fields or migration are added.
- [ ] Failure return shapes and item storage location remain compatible.

## Validation
- `node --input-type=module -e "import assert from 'node:assert/strict'; import { upgradeGear, getGearUpgradeCost } from './src/game/domain/gear.js'; const makeState=(item)=>({schemaVersion:1,player:{},equipment:{helmet:item,armor:null,gloves:null,boots:null,spear:null,horse:null},inventory:[],materials:1000,progression:{}}); const item={id:'test',slot:'helmet',rarity:'common',level:1,stats:{attack:10},effects:[]}; for (const [rngValues,expected,greatSuccess] of [[[0.5,0,0,0],11,false],[[0,0,0,0],12,true]]) { let i=0; const result=upgradeGear(makeState(item),'test',()=>rngValues[i++] ?? 0); assert.equal(result.ok,true); assert.equal(result.greatSuccess,greatSuccess); assert.equal(result.item.stats.attack,expected); assert.equal(result.item.level,2); assert.equal(result.state.materials,1000-getGearUpgradeCost(1)); }"` - deterministic ordinary-stat and great-success assertions pass.
- Run the additional unique effect-only injected-RNG case specified in I03 and assert the `lifeSteal` results are `0.031` and `0.032`.
- Verify a 0.999 critical-chance stat is capped at 1 after an additive upgrade; verify two 0.8 damage-reduction effects aggregate to 1.6 in `applyGearEffects` but cause zero contact damage in `resolveContact`.
- `npm.cmd run build` - Vite production build succeeds.

## Commit Message
```text
feat(gear): add stat-specific enhancement rolls

Plan: 2026-09-28-game-balance
Phase: P01-balance
Task: T02-enhancement-resolution

- Add additive special-stat upgrade ranges.
- Double selected gains on 5% great success.
```

## Progress
- [x] Implementation complete
- [x] Validation passed
- commit: pending
