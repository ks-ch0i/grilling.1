# Task: T01 Lethal Contact Resolution

## Status: done

## Goal
Make a contact hit that reduces the player's HP to zero end the current attempt, even if the player defeats that enemy in the same contact. The existing game-over panel must appear, and enemy defeat or stage-clear rewards must not run for that lethal exchange.

## Decision Summary
- Apply the player and enemy damage calculations independently. If the player reaches zero HP in the same contact that would defeat the enemy, player death takes precedence. Keep the existing retry snapshot rollback.
- Source decision: [2026-09-27-player-lethal-contact.md](../../../decisions/2026-09-27-player-lethal-contact.md)

## Implementation

### I01. Calculate player damage independently of enemy defeat

- Related Files:
  - `src/game/domain/combat.js` :: `resolveContact` - compute incoming player damage for every valid contact, regardless of whether the enemy is defeated; modify.

#### Details
- **Signatures & Types**:
  `resolveContact({ playerStats, enemyStats, playerEffects = [], rng = Math.random })` remains the public API and returns the existing result object including `playerDamage: number`, `playerHp: number`, and `playerDefeated: boolean`.
- **Data & Schema Fields**:
  - No schema changes. Player HP and attack/defense stats remain numbers. Existing effect totals and damage reduction remain applied.
- **Execution Flow / Logic**:
  1. Keep the independent incoming damage formula: `enemyStrikePlayerDamage = max(0, ceil(enemyAttack - playerDefense))`, `enemyRecoil = max(0, ceil(playerDefense - enemyAttack))`, then apply damage reduction.
  2. Set `playerDamage = min(currentPlayerHp, playerDamageAfterReduction)` without conditioning it on `enemyDefeated`.
  3. Calculate remaining player HP and `playerDefeated` from the resulting damage and existing life-steal behavior. Do not change critical, thorns, or healing formulas.
  4. Preserve the separate enemy HP calculation and return shape.

### I02. Route lethal contact to game over before defeat rewards

- Related Files:
  - `src/game/scenes/BattleScene.js` :: `BattleScene.handleContacts` - detect zero HP immediately after applying the contact result and before calling `defeatEnemy`; modify.
  - `src/game/domain/progression.js` :: `retryStage` - read-only; retain the existing snapshot rollback behavior.

#### Details
- **Signatures & Types**:
  - No new public signatures. `handleContacts(): void` uses the existing `resolveContact`, `retryStage`, `saveState`, and `showGameOver` methods.
- **Data & Schema Fields**:
  - No schema changes. The attempt snapshot remains `this.stageSnapshot`; player current HP is copied into the current game state before the lethal check.
- **Execution Flow / Logic**:
  1. Apply `result.enemyHp` and `result.playerHp` to their combatants and persist the current player HP as currently done.
  2. Update enemy health visuals and show the contact damage feedback.
  3. Before `defeatEnemy(enemy)`, check whether `this.player.currentHp <= 0`.
  4. On death, restore the attempt via `retryStage(this.stageSnapshot, this.gameState).state`, save that state, call `showGameOver()`, and return from `handleContacts`.
  5. Only for a surviving player, process enemy defeat, XP, drops, and possible stage completion. This prevents a simultaneous final-enemy kill from awarding completion before game over.
  6. Remove or consolidate the old post-knockback death check so one contact cannot run retry/game-over handling twice.

## Acceptance Criteria
- [x] Incoming player damage is calculated when the same contact defeats the enemy.
- [x] If incoming damage reduces player HP to zero, the source path invokes the existing game-over UI.
- [x] On a lethal exchange, enemy defeat rewards, gear drops, and stage-clear completion do not run.
- [x] A nonlethal killing hit still defeats the enemy and grants the existing rewards.
- [x] Existing stage retry behavior restores the attempt snapshot and preserves the current player progression according to `retryStage`.

## Validation
- `npm.cmd run build` - Vite production build succeeds.
- Run a focused Node check importing `resolveContact` from `src/game/domain/combat.js` with a player at 1 HP and an enemy whose attack exceeds player defense; assert that when player attack also defeats the enemy, `enemyDefeated` and `playerDefeated` are both true and `playerHp` is zero.
- Manually exercise a lethal contact in the browser - verify the game-over panel appears and no stage-clear/drop reward is granted for that exchange.

## Revalidation (2026-10-20)
- The specified deterministic Node assertion passed: result had `enemyDefeated: true`, `playerDefeated: true`, `enemyHp: 0`, and `playerHp: 0`.
- Source order in `BattleScene.handleContacts` applies both HP results, checks player HP, calls `retryStage`/`saveState`/`showGameOver`, and returns before `defeatEnemy`; a surviving player follows the defeat/reward path. `retryStage` passed an inline assertion for snapshot rollback, retained level/XP/pending level-up/stat choices, and full derived HP.
- At the earlier status audit, `npm run build` passed under Node `v20.19.4` (package requires `>=22.12.0`); Vite on port 4174 returned HTTP 200. Browser lethal/nonlethal exchange could not run at that time; see the later isolated Chromium verification below.
- The 9/27 decision supersedes the earlier 9/26 rule that suppressed retaliation on a killing hit: simultaneous player death now takes precedence and prevents enemy/stage rewards. The T04/T06 records now reflect that rule, and this task directly verifies both lethal and nonlethal killing contacts.
- Implementation commit confirmed: `5245a46 fix(combat): honor lethal damage on killing contacts`.

## Browser Verification (2026-10-20)
- In isolated Chromium at 1280x720, forced a same-contact lethal exchange (player HP 1, attack 1000, defense 0 against the first stage-1 enemy). The game-over panel displayed `쓰러졌습니다`; saved XP stayed 0, stage 1 remained uncleared, and retry restored HP to 100 while preserving the 17-material entry snapshot.
- In a separate fresh profile, forced a nonlethal killing contact (player HP 100, attack 1000, defense 100). The first enemy was defeated, XP increased by 10, and the player remained alive with HP 100; no stage clear was recorded.
- Both browser runs captured no page or console errors. Screenshots are in `%TEMP%\knight-run-residual-20261020`.
- The Node `22.12.0` production build passed in the same checkout during T07 integration verification; no game source changed for this verification.

## Commit Message
```text
fix(combat): honor lethal damage on killing contacts

Plan: 2026-09-27-player-lethal-contact
Phase: P01-lethal-contact
Task: T01-lethal-contact-resolution

- Calculate incoming contact damage independently from enemy defeat.
- Enter game over before processing lethal enemy or stage rewards.
```

## Progress
- [x] Implementation complete
- [x] Validation passed
- implementation commit: 5245a46
- browser verification commit: c41f3e9
