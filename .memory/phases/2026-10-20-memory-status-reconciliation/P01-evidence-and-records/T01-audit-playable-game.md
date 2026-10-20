# Task: T01 Audit Playable Game Plan

## Status: done

## Goal

Recheck the original 9/26 playable-game plan's implementation and validation evidence for all seven tasks, then update only the corresponding `.memory` records to reflect what was verified.

## Decision Summary

- The original plan's `Status: done`, phase `7/7`, and commit history are evidence to compare, not substitutes for acceptance checks.
- Do not modify game source. Leave any required manual criterion unchecked if its browser scenario cannot be completed.
- Existing task-to-commit candidates from local history: T01 `1870e2a`, T02 `ee01e1e`, T03 `65dde56`, T04 `3d46200`, T05 `6a6909d`, T06 `2d1c0c0`, T07 `942f5b1`. Confirm each subject against Git before recording it.

## Implementation

### Data & Schema Fields

- No game-state, save, or source-code schema changes are allowed.
- For each historical task, reconcile only `Status` (`done` or `in_progress`), acceptance checkbox booleans, validation text, and `commit` (`<confirmed hash>` or `pending`). The phase count is `done: integer/7`; the parent P01 status is `done` only when all seven tasks are done.

### I01. Revalidate the seven original task checklists

- Related Files:
  - `.memory/plans/2026-09-26-lancer-belt-scroll-game.md` :: P01 and T01–T07 plan table; modify status only after audit.
  - `.memory/phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/phase.md` :: seven task statuses and progress count; modify.
  - `.memory/phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/T01-app-shell.md` through `T07-game-flow-integration.md` :: acceptance criteria, validation, status, progress, commit; modify.
  - `package.json`, `index.html`, `vite.config.js`, `src/main.js:createGame`, `src/game/config.js:createGameConfig`, `src/game/scenes/BootScene.js:BootScene` :: app shell; read-only.
  - `src/game/data/balance.js`, `src/game/domain/models.js`, `src/game/domain/saveStore.js:{loadGameState,saveGameState,removeSavedGame}` :: state and persistence; read-only.
  - `src/game/domain/gear.js:{rollRarity,rollGear,createStarterEquipment,getGearStatSummary,createInitialState,equipGear,dismantleGear,getGearUpgradeCost,upgradeGear,derivePlayerStats,tryStoreDrop}` :: gear rules; read-only.
  - `src/game/domain/combat.js:{applyGearEffects,rollCritical,resolveContact}`, `src/game/domain/progression.js:{xpRequiredForLevel,grantXp,chooseLevelUpStat,stageId,getStageEnemyStats,getDropWeights,completeStage,retryStage}` :: combat/progression; read-only.
  - `src/game/scenes/TownScene.js:TownScene`, `src/game/ui/components.js:{createButton,createPanel,drawRarityFrame}`, `src/game/scenes/BattleScene.js:BattleScene` :: UI and battle; read-only.

#### Details

- Review each old task independently and record evidence in its own `Validation` and `Progress` section.
- T01 app shell: confirm `npm run dev` starts, title/boot screen renders, `npm run build` creates `dist/`, landscape uses the 16:9 game canvas, and portrait shows the rotate message.
- T02 persistence: confirm JSDoc/constants cover six gear slots, five rarities, stats, player, inventory, materials, and progression; save/load round-trips JSON; malformed/unsupported data falls back safely; `saveStore.js` contains no Phaser objects. In an isolated browser profile, save and reload and confirm the save survives.
- T03 gear: confirm stable IDs, valid slots/rarities, grade-scaled stats/effects, six common starter slots, swap without gear loss, no dismantling equipped gear, 20-item capacity, salvage and 5% double yield, level cap/costs/random upgrade rules. In the UI, inspect generated rarity/stats, equip/replace/dismantle/upgrade at levels 1/4/5/9/10/29, and verify a full inventory leaves a drop on the ground.
- T04 combat/progression: confirm enemy/player damage comparisons are independent and applied in the intended order; critical applies only to player attacks before enemy defense; XP/replay rewards, level-up, drops, boss multipliers, chapter unlock, and half-heal match the original task blueprint; invalid stat/stage inputs return explicit errors without partial mutation. In the UI, inspect weak-attack recoil, enemy-defeat retaliation suppression, critical-before-armor, max-HP level-up, replay XP, stage 5/10 bosses, and chapter unlock.
- T05 town: confirm new save opens at town with six common equipped items and correct stats/level/materials/empty inventory; inventory is capped at 20 excluding equipment; equip/dismantle/upgrade/stage-selection actions refresh state; rarity colors and Korean text fit at 1280x720. In the UI, exercise equip/swap, full inventory, dismantle, disabled upgrade states, replay selection, and touch-sized controls.
- T06 battle: confirm A/D and held touch controls, camera bounds, one contact hit per overlap transition, correct recoil/critical and player-only knockback without an invulnerability timer, 10 normal enemies, stage 5/10 bosses, drops and full-inventory behavior, level-up pause, clear and game-over actions. In the UI, exercise movement, both collision directions, crit, loot, level-up, stage clear, stage 5 boss, death/retry, and landscape touch controls.
- T07 integration: in a clean save, exercise new game → town → battle → pickup/equip → town → replay → partial XP → death/retry → stage 1 clear → stage 2 → stage 5 boss → stage 10 boss → next chapter → reload. Verify reload in town and during battle, with no console errors on desktop and touch landscape.
- Run browser checks against an isolated browser profile/origin; do not clear or overwrite existing local saves. If the environment cannot provide a browser or a scenario cannot be reached safely, record that exact check as unverified and keep the original task incomplete.
- Git commit mapping is metadata only. Use `git show --no-patch --format="%h %s" <hash>` to confirm subjects before filling `commit:`.

### I02. Build and browser validation

- Related Files:
  - `package.json` :: `build`, `dev`, `engines.node`; read-only.
  - Original T01–T07 task records :: validation results; modify.

#### Details

- Record `node --version` (expected current environment: `v20.19.4`) and the declared `>=22.12.0` engine requirement.
- Run `npm run build`; record its exact result and Node version. A pass on Node 20 does not count as a supported-engine pass.
- Run `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` and use the browser scenarios in I01. Stop the dev server after the checks. Do not add test files.

## Acceptance Criteria

- [x] Each original T01–T07 acceptance item is checked only when its code/source or runtime evidence is recorded.
- [x] All reachable manual scenarios above have a recorded result; unavailable scenarios remain explicitly unverified.
- [x] Each original task's status/progress matches its verified items; incomplete manual criteria keep that task and the 9/26 phase/plan incomplete.
- [x] The 9/26 plan table and phase count match the seven original task records.
- [x] Matching implementation commit hashes are recorded only after Git subject confirmation.
- [x] No game source file or save data is changed.

## Validation

- `node --version` — record actual runtime and compare with `package.json` engine.
- `npm run build` — record pass/failure under Node 20.19.4; do not claim supported-engine validation.
- `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` plus the exact isolated-browser scenarios in I01 — each completed observation or unavailable reason is recorded in T01–T07.
- `git show --no-patch --format="%h %s" <hash>` — confirm each implementation commit subject before recording it.

## Commit Message

```text
docs(memory): reconcile playable game verification records

Plan: 2026-10-20-memory-status-reconciliation
Phase: P01-evidence-and-records
Task: T01-audit-playable-game

- recheck the original playable-game task evidence
- align task and phase status with verified criteria
```

## Progress

- [x] Audit complete
- [x] Validation recorded
- commit: pending
