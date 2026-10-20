# Plan: Game Balance Adjustment

## Goal
Apply the confirmed balance changes to enemy growth, life steal, and equipment enhancement. Add per-special-stat additive upgrade ranges and a 5% great-success result while preserving ordinary integer-stat upgrades and existing saved equipment values. Show a concise great-success message in the town equipment panel.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `done ✅` | Balance, enhancement resolution, and town feedback/layout verified. | [P01](../phases/2026-09-28-game-balance/P01-balance/phase.md) |

> 2026-10-20 completion: P01 is done 3/3. Isolated Chromium verified great-success feedback, ordinary upgrade feedback, selection changes, layout, and save compatibility.

## Confirmed Design Constraints
- Source decision: [2026-09-28-game-balance.md](../decisions/2026-09-28-game-balance.md).
- Life steal values by rarity are 0%, 0%, 1%, 3%, and 5% from common through legendary. Current effect generation remains unique/legendary only.
- Enemy growth retains the existing multiplicative stage/chapter formula, with 20% stage growth and 80% chapter growth.
- Max HP, attack, and defense retain their current 1%–5% multiplicative increase and integer ceiling.
- Special upgrade amounts are additive and use their per-stat ranges from the decision record. Great success has a 5% chance and doubles the rolled increase.
- Existing saved item values are not migrated. New drops and post-update upgrades use the new rules.
- Do not change upgrade costs, max gear level, effect generation rarity, save schema, or the existing caps on critical chance and total damage reduction.

## Task Order
| Task | Scope | Files |
| :--- | :--- | :--- |
| T01 | Balance constants and enemy progression | `src/game/data/balance.js`, `src/game/domain/progression.js` |
| T02 | Additive special-stat upgrades and great-success roll | `src/game/data/balance.js`, `src/game/domain/gear.js` |
| T03 | Upgrade guidance and great-success town feedback | `src/game/scenes/TownScene.js` |
