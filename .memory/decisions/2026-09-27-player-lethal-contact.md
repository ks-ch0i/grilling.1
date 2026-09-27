# Decisions: Player Lethal Contact

- Date: 2026-09-27
- Status: Confirmed

## D01. Lethal enemy contact
- **Chosen**: If incoming contact damage equals or exceeds current HP, the player reaches 0 HP and the game over flow runs.
- **Rationale**: This is the behavior explicitly requested by the user and matches the existing independent player/enemy damage calculations.

## D02. Simultaneous defeat
- **Chosen**: Player death takes precedence if the same contact also defeats the enemy, including the stage's final enemy.
- **Rationale**: Enemy defeat must not cancel incoming damage; the user previously specified that both damage calculations happen independently.

## D03. Existing flow
- **Chosen**: Keep the current game over retry behavior and stage snapshot rollback; change only lethal contact resolution and its ordering where needed.
- **Rationale**: The existing BattleScene already routes zero HP to its game over panel and retryStage restores the attempt snapshot.

## Code findings
- `resolveContact` currently sets player damage to zero whenever the enemy is defeated in that same contact (`playerDamage = enemyDefeated ? 0 : ...`). This is why lethal incoming damage can be ignored on a killing hit.
- `BattleScene.handleContacts` checks player HP after processing enemy defeat, which can also let final-stage completion start before the lethal result is handled.