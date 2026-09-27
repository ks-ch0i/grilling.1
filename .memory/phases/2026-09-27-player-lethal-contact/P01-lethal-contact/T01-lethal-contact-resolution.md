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
- [ ] Incoming player damage is calculated when the same contact defeats the enemy.
- [ ] If incoming damage reduces player HP to zero, the existing game-over UI appears.
- [ ] On a lethal exchange, enemy defeat rewards, gear drops, and stage-clear completion do not run.
- [ ] A nonlethal killing hit still defeats the enemy and grants the existing rewards.
- [ ] Existing stage retry behavior restores the attempt snapshot and preserves the current player progression according to `retryStage`.

## Validation
- `npm.cmd run build` - Vite production build succeeds.
- Run a focused Node check importing `resolveContact` from `src/game/domain/combat.js` with a player at 1 HP and an enemy whose attack exceeds player defense; assert that when player attack also defeats the enemy, `enemyDefeated` and `playerDefeated` are both true and `playerHp` is zero.
- Manually exercise a lethal contact in the browser - verify the game-over panel appears and no stage-clear/drop reward is granted for that exchange.

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
- commit:  pending
