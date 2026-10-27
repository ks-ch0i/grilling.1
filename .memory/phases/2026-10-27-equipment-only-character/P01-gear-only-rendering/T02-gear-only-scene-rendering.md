# Task: T02 장비 레이어만 장면에 표시

## Status: pending

## Goal
마을 장비 미리보기와 일반·랭킹·PvP 전투에서 플레이어 캐릭터의 보이는 픽셀을 여섯 장비 레이어로 제한한다. 숨겨진 pose driver는 기존 프레임 동기화를 계속 제공한다.

## Decision Summary
- Town 말은 frame 10의 horse layer 하나로, 기사는 frame 10의 armor/boots/gloves/helmet/spear 레이어로만 그린다. 좌우 컨테이너 위치는 horse (556,118), rider (628,118)을 유지한다.
- 전투에서는 gear appearance에 연결된 mounted 합성을 표시한다. `knight` 액션 sprite와 `WholeBodyWalk` base는 애니메이션/pose driver로만 남겨서 화면에 base 픽셀을 그리지 않는다. 적의 기존 `WholeBodyWalk` 렌더링은 유지한다.

## Implementation

### I01. 장비 외형 renderer와 자산 검사

- Related Files:
  - `src/game/ui/equipmentAppearance.js` :: `renderTownEquipmentPreview(scene,equipment)`, `TOWN_KNIGHT_SLOTS`, `EquipmentAppearance`; modify
  - `src/game/ui/equipmentAppearanceAssets.js` :: `preloadEquipmentAppearanceAssets(load)`, `hasValidEquipmentAppearanceAssets(textures)`; modify
  - `src/game/scenes/TownScene.js` :: `createEquipmentPreview()` caller; read-only unless return contract needs forwarding
  - `test/equipment-appearance.test.js` :: Town rendering, preload, and texture completeness; modify
  - `test/town-profile-actions.test.js` :: Town equipment preview update; modify only if return-shape assertion requires it

#### Details
- **Signatures & Types**:
  ```js
  export function renderTownEquipmentPreview(scene, equipment)
  // Returns: { horseAppearance: EquipmentAppearance, knightAppearance: EquipmentAppearance }
  ```
- **Logic**:
  1. Keep horse container at `(556,118)` and render only `slots:['horse']`, `initialFrame:10`, origin `[0.5,0.5]`.
  2. Keep knight container at `(628,118)` and render only `slots:['armor','boots','gloves','helmet','spear']`, `initialFrame:10`, origin `[0.5,0.5]`.
  3. Do not create `walk-knight` or `knight-standing` base images. Return only the two `EquipmentAppearance` instances; update tests/callers from base fields if any.
  4. Remove `knight-standing` from equipment-appearance asset preload and validity requirements. All 30 gear atlases and all 12 frames remain required.
  5. `EquipmentAppearance` keeps missing slots invisible; do not substitute a base image or a different item's pixels.

### I02. 전투 기사 pose driver 비가시화

- Related Files:
  - `src/game/ui/WholeBodyWalk.js` :: `WholeBodyWalk(scene,parent,name,options)`; modify
  - `src/game/scenes/BattleScene.js` :: player constructor, `playKnightAnimation()`, `syncPlayerEquipmentAppearance()`; modify
  - `src/game/scenes/PvpScene.js` :: `createCharacterView()`; modify
  - `test/whole-body-walk.test.js` :: frame driver with and without rendered base; modify
  - `test/equipment-appearance.test.js` :: no-base Town composition and standalone asset validation; modify

#### Details
- **Signatures & Types**:
  ```js
  constructor(scene, parent, name, { renderBase = true } = {})
  ```
  `renderBase` is a boolean. Default `true` preserves enemy and preview behavior; player and PvP mounted rigs pass `false`.
- **Execution Flow / Logic**:
  1. `WholeBodyWalk` continues computing `frame`, `phase`, and facing for all characters. When `renderBase:false`, hide its base horse/rider container for its full lifetime; `follow()` must still update `frame` and sprite frame.
  2. In `BattleScene`, instantiate the player's `WholeBodyWalk` with `renderBase:false`. Keep the `knight` action sprite and animation completion listener for event/frame timing, but set its visible state to false at creation and never show it from `playKnightAnimation()`. Replace current toggles so walk and action states only switch driver animation/frame; `EquipmentAppearance` remains visible and follows the selected frame/facing.
  3. In `PvpScene.createCharacterView`, instantiate the rig with `renderBase:false`; preserve each fighter's own snapshot-derived `EquipmentAppearance`, frame advancement, and facing.
  4. Do not pass `renderBase:false` to enemy rigs or other non-player WholeBodyWalk callers. Equipment rendering, simulation state and ticket records remain unchanged.
  5. Tests must prove that the player rig remains visually hidden after `setVisible(true)` attempts if the API is called, while frame index still advances; default enemy rig remains visible. If this requires making `setVisible(visible)` respect `renderBase`, assert that contract.

### I03. 통합 회귀 테스트

- Related Files:
  - `test/equipment-appearance.test.js` :: layer-only town/battle contracts; modify
  - `test/whole-body-walk.test.js` :: hidden base frame driver; modify
  - `test/pvp/character-appearance.test.js` :: ticket snapshot still maps to its own layer keys; read-only unless assertions need strengthening
  - `test/equipment-appearance-assets.test.js` :: no standing base texture dependency; modify

#### Details
- Assert Town adds only 6 equipment layer images: horse on the left, five rider layers on the right; no image key `walk-knight` or `knight-standing` is added by `renderTownEquipmentPreview()`.
- Assert missing equipment yields no fallback image and `setEquipment()` continues changing only the designated slot.
- Assert PvP player and opponent retain different snapshot-derived texture keys.
- Assert the hidden driver still cycles 0–3 walk frames and Battle action frames map to atlas 4–9. Existing animation completion behavior is preserved.

## Acceptance Criteria
- [x] Town horse/rider render from equipment images only at the existing side-by-side positions.
- [x] Battle ordinary/ranked and both PvP fighters display no horse/rider base pixels beneath equipment layers.
- [x] Walk/action frame, facing, action completion, enemy visuals, and per-ticket gear snapshots remain functional.
- [x] Equipment asset validation no longer requires `knight-standing` but still rejects any incomplete 12-frame equipment atlas.

## Validation
- `node --test test/equipment-appearance.test.js test/equipment-appearance-assets.test.js test/whole-body-walk.test.js test/knight-animation.test.js test/pvp/character-appearance.test.js test/town-profile-actions.test.js` — 37/37 tests pass.
- `npm run build` — production Vite bundle succeeds; Vite reports the existing Phaser chunk size warning.
- `git diff --check` — no whitespace errors.
- Composite PNG review covered Common, mixed rarity, Legendary and the side-by-side Town preview in T01. Browser QA was not run: Windows Computer Use could not confidently identify the active Edge URL, so no browser UI action was taken.

## Commit Message
```text
fix(gear): render characters from equipment only

Plan: 2026-10-27-equipment-only-character
Phase: P01-gear-only-rendering
Task: T02-gear-only-scene-rendering

- Remove rider and horse base pixels from player views
- Keep hidden pose drivers synchronized with equipment layers
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: this task's planned commit
