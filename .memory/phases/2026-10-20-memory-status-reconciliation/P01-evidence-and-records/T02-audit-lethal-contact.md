# Task: T02 Audit Lethal Contact Plan

## Status: done

## Goal

Recheck the 9/27 lethal-contact change against its source and runtime criteria, then reconcile its original task, phase, and plan status without changing game code.

## Decision Summary

- The old task says `done`, but a done label and commit alone do not establish the browser acceptance criteria.
- Keep the retry snapshot semantics and simultaneous-kill precedence as recorded in the source decision.
- Candidate implementation commit is `5245a46`; confirm its subject before recording it.

## Implementation

### Data & Schema Fields

- No combat, save, or runtime schema changes are allowed.
- The historical task record fields are `Status` (`done` or `in_progress`), five acceptance checkbox booleans, validation text, and `commit` (`5245a46` only after Git confirmation, otherwise `pending`). The phase count is `done: integer/1` and the plan P01 status is `done` only when the task is done.

### I01. Verify contact result and BattleScene ordering

- Related Files:
  - `src/game/domain/combat.js` :: `resolveContact` — incoming player damage, enemy damage, `enemyDefeated`, `playerDefeated`, `enemyHp`, and `playerHp`; read-only.
  - `src/game/scenes/BattleScene.js` :: `BattleScene.handleContacts`, `defeatEnemy`, `showGameOver` — death precedence before rewards; read-only.
  - `src/game/domain/progression.js` :: `retryStage` — snapshot rollback while preserving current player progression and restoring HP; read-only.
  - `.memory/phases/2026-09-27-player-lethal-contact/P01-lethal-contact/T01-lethal-contact-resolution.md` :: criteria, validation, status, commit; modify.
  - `.memory/phases/2026-09-27-player-lethal-contact/P01-lethal-contact/phase.md` and `.memory/plans/2026-09-27-player-lethal-contact.md` :: propagate verified status; modify.

#### Details

- Run this deterministic domain assertion without adding a test file:

  ```powershell
  node --input-type=module -e "import assert from 'node:assert/strict'; import { resolveContact } from './src/game/domain/combat.js'; const result = resolveContact({ playerStats: { attack: 100, defense: 0, currentHp: 1, maxHp: 100, critChance: 0 }, enemyStats: { attack: 10, defense: 0, currentHp: 10, maxHp: 10 }, rng: () => 0.5 }); assert.equal(result.enemyDefeated, true); assert.equal(result.playerDefeated, true); assert.equal(result.playerHp, 0);"
  ```

- Read `BattleScene.handleContacts` and confirm it applies both combatant HP results, handles `this.player.currentHp <= 0` via `retryStage`/`saveState`/`showGameOver`, and returns before `defeatEnemy` can grant XP, drops, or stage completion.
- In the isolated browser app, arrange a lethal contact that also defeats the last enemy. Confirm the game-over panel appears and no enemy reward, drop, or stage-clear reward is granted. Also verify a nonlethal killing contact still grants normal rewards.
- Verify `retryStage(stageSnapshot,currentState)` restores the attempt snapshot, retains the current player's progression, and restores full derived max HP.
- Record separate outcomes for the five original acceptance criteria. If the browser exchange cannot be performed, leave the browser criterion unchecked and the old task/phase/plan incomplete.
- Run `npm run build` under the installed Node version and record the engine mismatch; do not alter the machine-wide Node installation.
- Start the app for the browser scenario with `npm run dev -- --host 127.0.0.1 --port 4174 --strictPort`; use a clean browser profile/origin and stop the dev server afterward.
- Confirm candidate commit with `git show --no-patch --format="%h %s" 5245a46` before filling its old `commit:` field.

## Acceptance Criteria

- [x] The deterministic `resolveContact` assertion passes with both `enemyDefeated` and `playerDefeated` true and `playerHp` zero.
- [x] Source order proves lethal player death reaches game over before `defeatEnemy` and rewards.
- [x] Browser lethal and nonlethal exchanges have recorded results; unavailable browser behavior remains unverified.
- [x] Retry behavior is verified against the stage snapshot and current player progression.
- [x] Original task/phase/plan status, progress, validation notes, and commit reference reflect only confirmed results.
- [x] No gameplay source or existing save data is modified.

## Validation

- The Node assertion in I01 — expected exit code 0.
- `npm run build` — record exact result and Node version; this environment does not meet the declared Node `>=22.12.0` requirement.
- Isolated browser lethal/nonlethal contact scenario — record game-over/reward outcome or exact unavailability reason.
- `git show --no-patch --format="%h %s" 5245a46` — confirm the implementation commit subject.

## Commit Message

```text
docs(memory): reconcile lethal contact verification records

Plan: 2026-10-20-memory-status-reconciliation
Phase: P01-evidence-and-records
Task: T02-audit-lethal-contact

- verify simultaneous lethal contact precedence
- align lethal-contact plan records with evidence
```

## Progress

- [x] Audit complete
- [x] Validation recorded
- commit: pending
