# Task: T03 Town Upgrade Feedback

## Status: in_progress

## Goal
Correct the town's enhancement guidance to describe the confirmed ordinary/special-stat rules and show a concise `강화 대성공!` message when an upgrade result reports great success.

## Decision Summary
- Ordinary upgrade guidance distinguishes integer stats (1%–5%) from special-stat ranges and states the 5% great-success chance with doubled increase.
- Great-success feedback is text only; it must not include numeric gain details.
- Source decision: [2026-09-28-game-balance.md](../../../decisions/2026-09-28-game-balance.md).

## Implementation

### I01. Render accurate upgrade guidance and great-success message

- Related Files:
  - `src/game/scenes/TownScene.js` :: `TownScene.constructor`, `init`, `renderSelectedItem`, and the `upgradeGear` button callback - retain feedback for the upgraded item and render it; modify.
  - `src/game/domain/gear.js` :: `upgradeGear` result - read-only; consume the `greatSuccess: boolean` added in T02.

#### Details
- **Signatures & Types**:
  - Keep all `TownScene` public methods and button actions unchanged.
  - Add private scene state `upgradeFeedback: { itemId: string, message: string } | null`.
  - Use the existing `upgradeGear(this.gameState, item.id)` success result `{ ok: true, state, cost, item, greatSuccess }`.
- **Data & Schema Fields**:
  - Do not persist feedback in the game state or save data.
  - Great-success message text is exactly `강화 대성공!`; the message has no numeric amount.
- **Execution Flow / Logic**:
  1. Initialize `upgradeFeedback` to `null` in scene initialization.
  2. In the existing upgrade button callback, after an `ok` result, set feedback to `{ itemId: item.id, message: '강화 대성공!' }` when `result.greatSuccess` is true; otherwise clear it. Then preserve the existing selected item update and `commitState(result.state)` flow.
  3. In `renderSelectedItem`, render the message only when feedback item ID matches the currently selected item. Place it below the upgrade button/help line within the existing right-hand equipment panel. Do not show feedback after failed upgrades or for a different selected item.
  4. Replace the inaccurate help text claiming every stat and effect rises by 1%–5%. Use concise Korean guidance that conveys: ordinary stats rise 1%–5%, special stats use their individual ranges, and great success occurs 5% of the time and doubles the rolled increase. Do not claim every property changes on each upgrade.
  5. Keep existing equipment stat formatting, selection, material display, save call, upgrade cost, and max-level behavior unchanged.

### I02. Verify town feedback and save compatibility

- Related Files:
  - `src/game/scenes/TownScene.js` :: upgrade result display - verify in browser.
  - `src/game/domain/saveStore.js` :: `saveGameState` and `loadGameState` - read-only; existing equipment values remain unchanged on load.

#### Details
- Build the Vite app and open the town equipment panel.
- Select both equipped and inventory gear; confirm the ordinary/special guidance is visible and does not overlap item details or controls.
- Confirm a non-great upgrade clears the previous great-success message; a great-success result displays `강화 대성공!` without a numeric amount; selecting another item hides the message.
- Confirm gear level, materials, and changed values still persist through the existing save/load path, with no save schema change or migration.
- Great success is stochastic in normal play. Verify the display by invoking the UI path with a result stub containing `greatSuccess: true` during focused manual inspection; separately verify actual 5% RNG behavior in T02.

## Acceptance Criteria
- [x] Upgrade guidance no longer claims every stat and effect rises by 1%–5% on every upgrade.
- [ ] Great success displays `강화 대성공!` only for the just-upgraded selected item and includes no numeric gain.
- [ ] Ordinary upgrade feedback, selection, state commit, materials, and persistence continue to work.
- [x] Existing saved equipment values are not migrated or reset.

## Validation
- `node --check src/game/scenes/TownScene.js` - passes.
- Focused source assertions confirm the great-success text is tied to `result.greatSuccess`, scoped to the matching item ID, and the obsolete tooltip is absent - pass.
- In-memory `saveGameState`/`loadGameState` round trip confirms a stored 12% life-steal value remains unchanged - pass.
- `node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build` - Vite production build succeeds; Vite reports the existing large-bundle warning.
- `Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing` - local development server returned HTTP 200.
- Manual visual inspection was unavailable: in-app browser initialization failed with missing `sandboxPolicy` metadata, and the Orca desktop runtime timed out waiting for its window. Layout and click behavior therefore remain visually unverified.

## Revalidation (2026-10-20)
- `node --check src/game/scenes/TownScene.js` and focused source assertions passed for ordinary/special guidance, the exact text `강화 대성공!`, `result.greatSuccess`, matching-item scoping, and removal of the obsolete tooltip.
- An in-memory save/load round-trip preserved a `lifeSteal: 0.12` value unchanged. `npm run build` passed under Node `v20.19.4` (package requires `>=22.12.0`) with the existing large-chunk warning; Vite on port 4175 returned HTTP 200.
- Browser rendering, selection changes, visual overlap, and forced great-success feedback remain unverified because no browser surface was available (`chrome` creation unavailable). Keep these acceptance items unchecked and this task/phase/plan in progress.
- Implementation commit confirmed: `6025bfd feat(ui): show gear enhancement great success`.

## Commit Message
```text
feat(ui): show gear enhancement great success

Plan: 2026-09-28-game-balance
Phase: P01-balance
Task: T03-town-feedback

- Correct town upgrade guidance for special-stat ranges.
- Show a concise message on great success.
```

## Progress
- [x] Implementation complete
- [ ] Validation passed; browser visual inspection remains unavailable
- commit: 6025bfd
