# Task: T03 PvP Gear Rendering

## Status: pending

## Goal
PvP의 사각형 플레이어/상대 표시를 기마 캐릭터로 교체하고, 티켓의 각 캐릭터 equipment snapshot에 맞는 장비 레이어를 적용한다. 두 외형은 입력 또는 로컬 저장을 변경하지 않는다.

## Decision Summary
- PvP는 고정된 1280×720 arena와 현재 match simulation을 유지한다. 양쪽 기사는 기마 상태이며, 각자의 저장 snapshot에서 장비를 읽는다.
- P02-T02의 `EquipmentAppearance` 및 T01의 atlas frame contract를 재사용한다. PvP 버전/레이팅/전투 입력 규칙은 변경하지 않는다.

## Implementation

### I01. PvP 캐릭터를 snapshot 장비로 렌더링

- Related Files:
  - `src/game/scenes/PvpScene.js` :: `init`, `create`, `renderCombatState`, `update` — 사각형 표시를 말·기수와 장비 레이어로 교체; modify
  - `src/game/ui/WholeBodyWalk.js` :: `WholeBodyWalk` — 두 말/기수의 보행 pose와 좌우 방향 재사용; read-only
  - `src/game/ui/equipmentAppearance.js` :: `EquipmentAppearance` — 양쪽 장비 layer; read-only
  - `test/pvp/character-appearance.test.js` :: PvP view snapshot mapping and facing tests; new
  - `test/pvp/pvpClient.test.js` :: ticket snapshot equipment contract; modify only if needed

#### Details
- **Signatures & Types**:
  ```js
  // PvpScene instance fields after create:
  this.playerView = { container: Phaser.GameObjects.Container, walkRig: WholeBodyWalk,
                      appearance: EquipmentAppearance, lastX: number };
  this.opponentView = { container: Phaser.GameObjects.Container, walkRig: WholeBodyWalk,
                        appearance: EquipmentAppearance, lastX: number };
  ```
- **Data & Schema Fields**:
  - Player visual gear source: `ticket.playerSnapshot.equipment: Record<GearSlot,GearItem|null>`.
  - Opponent visual gear source: `ticket.opponentSnapshot.equipment: Record<GearSlot,GearItem|null>`.
  - Combat positions continue to come from `runState.player.x` and `runState.opponent.x`; combat stats and input still come only from `createPvpRun`/`stepPvpRun`.
- **Execution Flow / Logic**:
  1. Precondition & Validation: before creating visual objects, require both snapshots to contain a plain `equipment` object with the six known slots; each non-null item must have a known slot and one of five rarity keys. Invalid data follows the existing `showSubmissionFailure('invalid-match-ticket')` path; do not create a partially decorated match.
  2. Core Processing: replace `add.rectangle` fighter visuals with two containers anchored at their simulation x and `FLOOR_Y=560`. Construct `WholeBodyWalk(scene, container, 'knight')` for each, then `EquipmentAppearance(scene, container, snapshot.equipment, {scale:WALK_CHARACTERS.knight.walkHeight / knightHorseContentHeight, origin:[0.5,244/256]})`. Use gear frame 0 for stationary frame initialization; update to 0..3 based on each walk rig's gait frame.
  3. Facing & Movement: in `renderCombatState`, copy each x from the run state. Compute `moving = abs(x-lastX) > 0.01`; player faces toward the opponent (`direction = opponent.x >= player.x ? 1 : -1`) and opponent faces toward the player. Call each `walkRig.follow(x,moving,direction,delta)` and `appearance.setFacing(direction)`; record new x. Keep HP bars, labels, clock and footer coordinates unchanged.
  4. Error & Exception Handling: do not alter ticket snapshot objects. If renderer construction throws due to a missing asset, use the existing PvpScene failure overlay and stop match input/result submission; BootScene asset validation should make this path defensive only.
  5. State Transition & Return: animation is view-only. Do not add or modify simulation events, PvpRun state, input log, server ticket, result payload, rating, or `PVP_SIMULATOR_VERSION`.

### I02. PvP visual regression checks

- Related Files:
  - `test/pvp/character-appearance.test.js` :: two-snapshot mapping, independent rarity selection, facing, and no snapshot mutation; new
  - `test/pvp/pvpClient.test.js` :: serialized equipment snapshot assertions; modify only if current fixtures omit required slots

#### Details
- Use a player fixture with rare helmet/common horse and opponent fixture with legendary helmet/rare horse. Assert the two render descriptors choose independent keys from their own snapshots.
- Assert missing equipment or unknown rarity is rejected before simulation input/render loop starts.
- Assert player/opponent facing signs point toward each other at x=120 and x=700 and update after crossing positions.
- Assert source snapshot objects remain deep-equal after constructing/updating appearance descriptors.
- Keep existing PvP result and ticket contracts unchanged.

## Acceptance Criteria
- [ ] PvP displays two mounted knight/horse sprites at simulation positions with rarity-matched equipment layers from the correct snapshot.
- [ ] Player and opponent can use different slot/rarity appearances; direction flips and gait frames remain aligned.
- [ ] HP, timer, labels, input recorder, and server result submission behave as before.
- [ ] PvP simulator and rating versions remain unchanged.

## Validation
- `node --test test/pvp/character-appearance.test.js test/pvp/pvpClient.test.js` — snapshot-to-view mapping, invalid ticket, and no-mutation checks pass.
- `npm run build` — PvP imports and equipment texture keys bundle successfully.

## Commit Message
```text
feat(pvp): show snapshot equipment on both fighters

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P02-equipment-visuals
Task: T03-pvp-gear-rendering

- Replace PvP fighter rectangles with mounted views
- Render each side from its own equipment snapshot
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
