# Task: T02 Battle and Town Gear Rendering

## Status: done

## Goal
T01의 슬롯·희귀도 이미지로 장착 외형을 일반·랭킹 전투 기사와 마을 미리보기에 렌더링한다. 공격/피격/쓰러짐과 이동 프레임 전환 중에도 레이어가 사라지거나 몸체 기준선에서 어긋나지 않게 한다.

## Decision Summary
- 렌더러는 `equipment[slot].rarity`만 읽고 asset manifest에서 texture를 선택한다. 빈 슬롯은 레이어를 숨기며 레벨·능력치·효과에 따라 프레임을 바꾸지 않는다.
- 사용자 선택: 장비 한 종류 파일에 움직임 그림 10장(걷기 4장과 전투동작 6장)을 함께 둔다. 마을용 기본 입상 기사는 별도 이미지다.
- 사용자 확정: 같은 장비 파일에 입상 자세용 레이어 1장을 추가한다. 순서는 걷기 0–3, `knight-actions`와 정렬한 전투동작 4–9, 마을 입상 레이어 10, 투명 패딩 11이다. 대기 상태는 기존 `WholeBodyWalk`가 선택한 0 또는 2번 걷기 그림을 쓴다.

## Implementation

### I01. 공통 장비 레이어 표시 객체

- Related Files:
  - `src/game/ui/equipmentAppearance.js` :: `EquipmentAppearance`, `getEquipmentTextureKey` — 장비 슬롯별 Phaser overlay image 생성·frame 동기화·해제; new
  - `src/game/ui/equipmentAppearanceAssets.js` :: T01 manifest exports — texture/frame lookup; read-only
  - `src/game/ui/WholeBodyWalk.js` :: `WholeBodyWalk.frame`, `WholeBodyWalk.setFacing` — 0–3 gait frame와 좌우 방향 입력; read-only
  - `test/equipment-appearance.test.js` :: layer key/state/frame/visibility tests; new

#### Details
- **Signatures & Types**:
  ```js
  export function getEquipmentTextureKey(slot, rarity); // -> string, validates slot/rarity via manifest
  export class EquipmentAppearance {
    constructor(scene, parent, equipment, {
      scale,
      origin = [0.5, 244 / 256],
      slots = ['horse','armor','boots','gloves','helmet','spear'],
      initialFrame = 0,
    });
    setEquipment(equipment); // Record<GearSlot, GearItem|null>
    setFrame(frameIndex); // integer 0..10; 11 is reserved and must be rejected
    setFacing(direction); // -1 or +1; invalid/0 retains current facing
    setVisible(visible);
    destroy();
  }
  ```
- **Data & Schema Fields**:
  - The renderer accepts the existing `GameState.equipment: Record<GearSlot, GearItem|null>` unchanged. It reads only `slot` and `rarity`; `id`, `level`, `stats`, and `effects` do not select art.
  - Each visible `slot` has one Phaser image child at local `(0,0)`, origin `[0.5,244/256]`, and caller-provided scale. Child insertion order is `horse, armor, boots, gloves, helmet, spear` so horse/body pieces stay behind rider details.
  - For a null slot, keep the corresponding child but set it invisible; changing to a non-null gear item switches texture key to `gear-${slot}-${rarity}` and shows it.
- **Execution Flow / Logic**:
  1. Precondition & Validation: reject a non-container parent, non-finite/non-positive scale, invalid slot/rarity, non-integer frame, or frame outside 0..10 with `TypeError`/`RangeError`. The caller owns scene and parent lifecycle.
  2. Core Processing: create one image per requested slot using the manifest key, caller transform, and requested frame. `setFrame(0..3)` serves gait; `setFrame(4..9)` serves action overlays; `setFrame(10)` serves the standing preview. `setFacing(1)` flips each layer horizontally to match `BattleScene.updatePlayerVisual`; `-1` clears the flip. Mirror the entire slot image, not a second asset.
  3. Error & Exception Handling: do not throw from animation update for a missing texture; BootScene validation in I02 prevents scenes from starting with incomplete appearance assets. `destroy()` is idempotent and destroys every child once.
  4. State Transition & Return: `setEquipment` changes only affected texture/visibility; `setFrame` updates all visible slot images. The helper never mutates the supplied equipment object.

### I02. Boot preload, BattleScene state synchronization, and TownScene preview

- Related Files:
  - `src/game/scenes/BootScene.js` :: `preload`, `hasValidKnightTexture`, `create` — load and validate all gear sheets plus standing base before TownScene; modify
  - `src/game/scenes/BattleScene.js` :: `createPlayer`, `playKnightAnimation`, `updatePlayerVisual`, `updateLocomotion`, `spawnStage` — attach current equipment and select matching walk/action frames; modify
  - `src/game/scenes/TownScene.js` :: `renderTown`, `refresh` — side-by-side live equipment preview in reserved header space; modify
  - `test/equipment-appearance.test.js` :: Battle frame routing and null slots; modify
  - `test/town-profile-actions.test.js` :: immediate preview refresh after equip/unequip while details panel remains; modify
  - `test/knight-animation.test.js` :: action frame mapping; modify
  - `test/whole-body-walk.test.js` :: walk frame and facing contract; modify

#### Details
- **Data & Schema Fields**:
  - No save/equipment schema changes. Town reads `this.gameState.equipment`; ordinary battle reads `this.gameState.equipment`; ranked battle uses the canonical `this.gameState.equipment` installed for the run.
  - New mount art: `walk-knight` frame 0 for the Town horse, `knight-standing` for the Town article, and the existing 4-frame `walk-knight`/fixed `knight-rider` plus six-frame `knight` action atlas for combat.
- **Execution Flow / Logic**:
  1. Preload: in `BootScene.preload`, iterate `EQUIPMENT_APPEARANCE_ASSETS` and call `load.spritesheet(key,path,{frameWidth:256,frameHeight:256})`; load `/assets/gear/knight-standing.png` as `knight-standing`. Before starting TownScene, validate all 30 textures contain frames `0` through `11`, and the standing texture exists. On failure, display a concise resource-load error and do not start a partially rendered game.
  2. Battle creation: after `WholeBodyWalk` is attached to `player.view`, construct `EquipmentAppearance` as a sibling under `player.view` with `this.gameState.equipment`, `scale=player.spriteScale`, and the existing knight origin. This overlay remains on top while the walk rig or action sprite alternates visibility.
  3. Battle synchronization: after `walkRig.follow`, when no `visualAction` is active, set overlay frame to `walkRig.frame`; when `visualAction` is active, set overlay frame to `4 + numeric(player.sprite.frame.name)` (numeric base frame is 0..5). Call `setFacing(player.facingDirection)` whenever `updatePlayerVisual` changes direction. Keep `WholeBodyWalk.setVisible` and action sprite toggles unchanged. Destroy the overlay with the player view/scene.
  4. Town preview: in `renderTown`, place a horse preview centered at `(556,118)` and a standing knight preview centered at `(628,118)` within a 144×80 logical region x=520..664. Scale both to 64px display height while preserving aspect ratio. Attach a `slots:['horse']` frame-10 layer set to the horse; attach `slots:['helmet','armor','gloves','boots','spear']` frame-10 layer set to the standing knight. The Lv/status text starts at x=700; the selected area must not overlap it. Keep equipment/inventory/detail panels and button callbacks unchanged.
  5. Refresh: `TownScene.refresh` already removes and rebuilds all children; construct new preview base and overlay children after every `renderTown`, so equip/unequip `commitState` updates are immediately visible and no destroyed overlay is reused.
  6. Error & Exception Handling: invalid asset manifest is stopped in BootScene. A null equipped slot remains invisible. Player movement, collision, action priority, floor, and saved state do not change.

## Acceptance Criteria
- [x] General and ranked BattleScene show equipped layer art on all 4 gait frames and all 6 contact/hit/defeat frames; left/right flips remain aligned.
- [x] Slot selection depends only on slot and rarity; empty slots hide cleanly; runtime state and save data are not mutated.
- [x] TownScene shows a 64px horse at x=556 and a 64px standing knight at x=628 inside the 144×80 header area, updates after equip/unequip, and keeps the detail panel usable.
- [x] BootScene refuses a partial appearance asset set with a visible load error instead of starting a scene with missing textures.

## Validation
- `node --test test/equipment-appearance.test.js test/knight-animation.test.js test/whole-body-walk.test.js test/town-profile-actions.test.js` — frame routing, facing, empty slots, and TownScene refresh contracts pass.
- `npm run build` — all manifest texture paths and renderer imports bundle successfully.

## Commit Message
```text
feat(gear): render equipment in battle and town

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P02-equipment-visuals
Task: T02-battle-town-gear-rendering

- Synchronize mounted gear layers with gait and action frames
- Add the side-by-side Town horse and standing knight preview
```

## Progress
- [x] 구현 완료
- [x] 검증 통과 — focused tests 26/26, Vite production build, `git diff --check`.
- commit message: `feat(gear): render equipment in battle and town`
