# Task: T05 마을과 장비 관리 화면

## Status: done

## Goal

플레이어가 시작과 각 스테이지 사이에 마을에서 여섯 장비 슬롯·인벤토리·재료·레벨을 확인하고, 장비를 교체·분해·강화하거나 해금 스테이지를 선택할 수 있게 한다.

## Decision Summary

- 모든 UI는 Phaser 도형과 한국어 텍스트로 그린다. DOM framework, 이미지, 오디오를 추가하지 않는다.
- 도메인 연산은 T03/T04 함수를 호출한다. 장착 중인 아이템은 20칸 인벤토리 목록에 나타나지 않는다.

## Implementation

### I01. 재사용 버튼과 패널 도형

- Related Files:
  - `src/game/ui/components.js` :: `createButton`, `createPanel`, `drawRarityFrame`; new

#### Details
- Signatures:
  ```js
  export function createButton(scene, { x, y, width, height, label, onClick, enabled = true })
  export function createPanel(scene, { x, y, width, height, title })
  export function drawRarityFrame(scene, x, y, width, height, rarity)
  ```
- Buttons use rectangle + centered Korean text. Enabled button registers pointerdown; disabled button has alpha 0.45 and no handler. Return a destroyable Phaser GameObject container.
- Rarity frame colors come only from `RARITY_COLOR`. Do not create independent rarity color maps.

### I02. TownScene stateful menu

- Related Files:
  - `src/game/scenes/TownScene.js` :: `TownScene`, `init`, `create`, `renderTown`, `selectInventoryItem`, `refresh`; new
  - `src/game/config.js` :: scene registration; modify

#### Details
- Scene key `TownScene`; data passed in `init(data)` is `{gameState, saveState, unlockedStageId, replayXpMultiplier}`. Store `gameState` as plain state; call `saveState(gameState)` after every permanent mutation.
- Fixed 1280x720 logical layout: header at y<100 (chapter/stage unlock, player level/xp, HP, materials); left panel x=32..450 for six equipped slots; center panel x=470..900 for up to 20 inventory entries in a scrollable 2-column grid; right panel x=920..1248 for selected-item detail/actions; bottom row for stage selection.
- Each equipped slot displays localized name, rarity border/color, level, and its contribution. Clicking a slot selects its equipped item. Inventory cards show localized slot/rarity, level, rolled stats, effect IDs as Korean labels, and an `장착` action.
- Selected inventory item actions: `장착`, `분해`, `강화`. Selected equipped item actions: `강화` only. Show material cost and random outcome preview range before upgrade. Disable upgrade if level 30 or insufficient materials. Disable `장착` when replacement would exceed inventory capacity.
- Stage panel offers only currently unlocked next stage and previously cleared stage IDs. Choosing a cleared stage sets `isReplay:true`; next stage sets false. Show a `전투 출발` action. Stage 10 completion unlocks next chapter’s stage 1.
- Reuse `equipGear`, `dismantleGear`, `upgradeGear`, `derivePlayerStats`, progression helpers. Never mutate `gameState` directly in button callbacks; replace with returned state and redraw.
- Responsive logical canvas retains 1280x720 FIT layout. Ensure touch target minimum is 48x48 logical px and inventory list can scroll vertically.

## Acceptance Criteria
- [x] New game opens at town with six common equipped items, player stats, level, materials, and empty inventory.
- [x] Inventory capacity excludes six equipped slots and respects max 20.
- [x] Equip, dismantle, upgrade, and stage selection controls call the domain functions and refresh the UI.
- [x] Rare colors match the five fixed rarity colors; Korean UI text fits at 1280x720.

## Validation
- `npm run build` — TownScene and UI components compile.
- `npm run dev` manual browser check — equip/swap, full inventory, dismantle, upgrade disable states, replay stage selection, and touch-sized buttons.

## Revalidation (2026-10-20)
- Fresh isolated Chromium profile opened directly into the new-game town: all six equipped slots were common, the player was level 1 with XP 0/100, materials and inventory were empty, and the unlocked stage was 1-1. The 1280x720 capture shows the player stats and Korean labels fit within the layout.
- Rendered common, uncommon, rare, unique, and legendary inventory cards; their frame colors matched `RARITY_COLOR` (gray, white, blue, purple, gold). Equip/swap moved the replaced starter helmet into inventory; dismantling a rare item removed it and awarded 4 materials.
- Clicked disabled upgrade controls for insufficient materials and max level, and a disabled equip control with a full 20-item inventory; all left saved state unchanged. A cleared-stage selection showed the 30% replay XP label and launched stage 1-2. All action buttons meet the 48px logical minimum; cards and stage controls are larger.
- Browser console and page errors were empty. `npm run build` passed with Node `22.12.0`; Vite emitted its existing advisory that the minified JavaScript chunk exceeds 500 kB. All browser checks used a fresh isolated profile and did not access existing saves.
- Implementation commit confirmed: `6a6909d feat(game): build village gear and stage management UI`.
- Manual browser checks completed: new-game town, rarity colors/text fit, equip/swap, dismantle, upgrade disabled states, full-inventory equip disabled state, replay selection/departure, and touch-target sizing.

## Commit Message
```text
feat(game): build village gear and stage management UI

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T05-town-ui

- render Korean village hub with equipment and inventory panels
- connect equip, dismantle, upgrade, and stage selection actions
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 6a6909d

