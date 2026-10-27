# Task: T02 Background Scene Integration

## Status: done

## Goal
BootScene에서 P03-T01의 17개 배경 에셋을 preload하고, 챕터별 전투 테마와 약한 전투 시차 레이어, 정지 마을·PvP 배경을 각 장면에 연결한다. 카메라 추적, HUD 배치, 캐릭터 동작, `FLOOR_Y=560` 충돌 규칙은 유지한다.

## Dependencies
- P03-T01의 15개 전투 레이어 이미지, 정지 배경 2개, `sceneBackgroundAssets.js` manifest 및 asset validation이 완료되어야 한다.
- P01-T01의 4,800px 전투 월드 크기와 P02 장비 렌더링 depth 계약을 사용한다.

## Implementation

### I01. 테마 선택 및 공통 배경 helper

- Related Files:
  - `src/game/ui/sceneBackgrounds.js` :: `getBattleThemeForChapter`, `createBattleBackgroundLayers`, `createStaticSceneBackground` — new
  - `src/game/ui/sceneBackgroundAssets.js` :: `BATTLE_BACKGROUND_THEMES`, `BACKGROUND_ASSETS`, `getBattleBackgroundAssetKeys` — consume P03-T01 manifest
  - `test/scene-backgrounds.test.js` :: chapter cycle, stable keys, and layer configuration tests — new

#### Details
- **Signatures & Types**:
  ```js
  export function getBattleThemeForChapter(chapter: number): string;
  export function createBattleBackgroundLayers(scene: Phaser.Scene, chapter: number): {
    far: Phaser.GameObjects.Image;
    mid: Phaser.GameObjects.TileSprite;
    front: Phaser.GameObjects.TileSprite;
  };
  export function createStaticSceneBackground(scene: Phaser.Scene, kind: 'town' | 'pvp'): Phaser.GameObjects.Image;
  ```
- **Data & Asset Fields**:
  - Chapter mapping is one-based: `(chapter - 1) % 5`; chapters 1, 6, 11 use `forest-trail`, 2, 7, 12 use `ruined-village`, then `rocky-canyon`, `snowy-fortress`, `volcanic-citadel`.
  - Reject non-finite or less-than-1 chapter values with `RangeError`; do not silently choose a theme for malformed chapter data.
  - Resolve all Phaser texture keys through the T01 manifest. Do not duplicate filenames or theme order in a scene.
  - Battle layer factors are fixed, subtle values: far `0.88`, mid `0.95`, front `1.0`. All layers begin at logical y=0 and are bounded to the 4,800px world plus one 1,280px viewport-width coverage margin so the camera never reveals an empty edge.
  - The far image keeps its logical 4,800×560 size. Mid/front use 1,280×560 repeating textures; set their tile position from camera scroll so repeated content moves at its assigned parallax factor without seams.
  - Static scene keys resolve to `background-town-frontier-square` and `background-pvp-stone-arena`; render at logical 1,280×720 and fixed scroll factor.
- **Execution Flow / Logic**:
  1. Validate chapter input and compute the cyclic theme from the manifest's ordered theme array.
  2. Build far, mid, and front display objects behind gameplay. Use object depths `-30`, `-20`, and `-10`; floor strip/line use `0`, fighters and enemies remain above them, and existing HUD depth remains fixed to the camera.
  3. Keep parallax gentle and deterministic from camera scroll only. Do not add time-based background motion, random scenery, camera easing, or gameplay simulation inputs.
  4. Return created objects so each scene can update only the scrolling tile positions when the camera moves; keep helper code free of scene-specific UI and combat state.

### I02. preload와 게임 장면 연결

- Related Files:
  - `src/game/scenes/BootScene.js` :: `preload` — load all manifest background records with stable keys
  - `src/game/scenes/BattleScene.js` :: `create`, `drawWorld`, `update` — choose chapter theme, draw layers before floor, update tile positions
  - `src/game/scenes/TownScene.js` :: `renderTown` — draw static frontier-town background before interactive town content
  - `src/game/scenes/PvpScene.js` :: `create` — replace arena color rectangles with static stone-arena background
  - `test/scene-backgrounds.test.js` — scene hook and depth contract checks
  - `test/background-assets.test.js` — retain P03-T01 manifest/file checks

#### Details
- **Signatures & Types**:
  ```js
  // BootScene.preload(): load every BACKGROUND_ASSETS entry as Phaser image key/path.
  // BattleScene: this.backgroundLayers = createBattleBackgroundLayers(this, chapter);
  // TownScene.renderTown(): static town image is recreated as part of normal refresh.
  // PvpScene.create(): arena background remains camera-fixed and behind actors.
  ```
- **Scene Geometry & Ordering**:
  - Battle uses the current 1,280×720 camera and `WORLD_WIDTH=4,800`; do not alter camera bounds or follow/deadzone behavior.
  - Keep a readable low-detail floor strip from y=560 down and a visible floor line at y=560, with collision and actor foot positions unchanged. Background art must not replace simulation floor geometry.
  - Remove only the old decorative skyline/solid arena fills that the approved artwork replaces. Keep the floor strip/line, fight entities, drops, HUD, overlays, Town controls, and PvP status/result UI.
  - Add the Town background inside `renderTown()` after its child reset/clear behavior so refresh reconstructs it; it must not be an untracked orphan or cover later controls.
  - In PvP, draw the arena image before both fighters and preserve their current fixed-screen layout and battle UI.
  - Set explicit depths: scene backgrounds below floor and gameplay, town controls and PvP UI above background. Do not change P02 equipment overlay depth relative to the corresponding fighter.
- **Error & Exception Handling**:
  1. Missing textures should fail visibly during development and through the asset manifest test; do not fall back to solid color and conceal a missing asset.
  2. Unknown chapter values fail at the theme helper boundary. Existing valid stage/chapter data must pass through unchanged.
  3. Verify that a camera at the world start, midpoint, and maximum travel does not expose a blank stripe in any layer.
  4. If an image's visible art touches y=560 too densely, adjust the asset in T01 review; do not move the floor or shift character y positions to hide it.
- **State Transition & Return**:
  1. `BootScene.preload` makes all 17 textures available before Town, Battle, or PvP begins.
  2. Battle selects a theme from its active stage chapter and retains the same three layers through the scene lifetime.
  3. Town and PvP show their respective static image on initial draw and after any Town rerender.
  4. Normal/ranked match state, replay records, scoring, and camera movement remain unchanged by rendering.

## Acceptance Criteria
- [ ] All manifest background assets preload before any target scene uses them.
- [ ] Chapter mapping cycles through the five approved themes in order, including chapter 6 returning to forest trail.
- [ ] Normal and ranked stages in the same chapter use the same three background textures.
- [ ] Battle parallax has subtle depth movement, covers camera travel from start to end, and never exposes blank edges.
- [ ] Town refresh retains the frontier-town background beneath its interactive panels; PvP shows the stone arena beneath both fighters and UI.
- [ ] Floor art remains legible and `FLOOR_Y=560`, collision, camera bounds, actor positions, HUD, and equipment overlays are unchanged.

## Validation
- `node --test test/scene-backgrounds.test.js test/background-assets.test.js` — chapter cycles, manifest mapping, texture readiness contract, layer factors/depths, asset dimensions and paths.
- `npm run build` — verify Phaser helper imports and all texture references bundle.
- Manual game review at 1280×720 — inspect Town initial render and post-refresh, normal and ranked stages from chapters 1–5 plus chapter 6, PvP actor/UI visibility, and Battle camera at start/middle/end.
- Review each scene for floor visibility and unchanged combat framing; no test or build is run during the planning phase.

## Commit Message
```text
feat(art): integrate scene backgrounds

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P03-scene-backgrounds
Task: T02-background-scene-integration

- Add chapter-cycled layered battle scenery with subtle parallax
- Apply static town and PvP backgrounds behind scene content
```

## Progress
- [x] 구현 완료 — BootScene, BattleScene, TownScene, PvpScene에 배경을 연결했다.
- [x] 검증 통과 — 배경 테스트 9/9, Vite production build, `git diff --check`.
- [x] 런타임 결함 수정 — 전투 시작 시 유효하게 발생하는 `camera.scrollX=-520`을 배경 helper가 거부해 씬 업데이트가 중단됐다. 유한한 음수 스크롤도 허용하고 회귀 테스트를 추가했다.
- [ ] 수동 화면 재확인 — 수정 후 Vite가 페이지를 다시 불러온 것은 확인했으나, 전투 시작 버튼을 다시 누른 결과는 아직 확인되지 않았다.
- commit message: `feat(art): integrate scene backgrounds`
