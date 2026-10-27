# Task: T01 Background Art Assets

## Status: pending

## Goal
페인터리 스타일의 마을·PvP 정지 배경 2장과 전투 5테마별 원경 파노라마·중경 반복 타일·전경 반복 타일을 만든다. 각 파일은 선택된 환경 테마에 맞고 전투 인물을 가리지 않는 레이어로 사용할 수 있어야 한다.

## Decision Summary
- 배경은 부드러운 페인터리이며, 원경은 월드 길이 파노라마, 중경·전경은 반복 가능한 투명 타일이다. Town/PvP는 깊이감은 표현하되 정지 이미지로 제공한다.
- 아트 생성 결과는 production asset으로 검수된 뒤에만 `public/assets/backgrounds/`에 복사한다. 이전 숲길 스타일 비교 시안은 production background로 재사용하지 않는다.

## Implementation

### I01. 전투 테마 15개 레이어와 정지 장면 2개 생성

- Related Files:
  - `public/assets/backgrounds/battle/forest-trail-far.png` — 4,800×560 logical panorama; new
  - `public/assets/backgrounds/battle/forest-trail-mid.png` — 1,280×560 logical seamless RGBA tile; new
  - `public/assets/backgrounds/battle/forest-trail-front.png` — 1,280×560 logical seamless RGBA tile; new
  - `public/assets/backgrounds/battle/ruined-village-{far,mid,front}.png` — same per-layer dimensions; new
  - `public/assets/backgrounds/battle/rocky-canyon-{far,mid,front}.png` — same per-layer dimensions; new
  - `public/assets/backgrounds/battle/snowy-fortress-{far,mid,front}.png` — same per-layer dimensions; new
  - `public/assets/backgrounds/battle/volcanic-citadel-{far,mid,front}.png` — same per-layer dimensions; new
  - `public/assets/backgrounds/town-frontier-square.png` — 1,280×720 static scene; new
  - `public/assets/backgrounds/pvp-stone-arena.png` — 1,280×720 static scene; new

#### Details
- **Signatures & Types**:
  ```text
  Asset groups:
  BattleFarPanorama = PNG, logical display size 4800x560, opaque painterly landscape
  BattleParallaxTile = PNG, logical tile size 1280x560, RGBA alpha, seamless horizontal loop
  StaticSceneBackground = PNG, logical display size 1280x720, painterly scene
  ```
- **Data & Asset Fields**:
  - Battle theme names and order are `forest-trail`, `ruined-village`, `rocky-canyon`, `snowy-fortress`, `volcanic-citadel`.
  - Each theme has exactly `far`, `mid`, and `front` layers. The `far` image spans the 4,800px world; `mid` and `front` are independently loopable horizontal tiles with transparent sky/upper regions.
  - Far art fills y=0..560 and contains sky/distant terrain only. Mid/front layers contain progressively closer trees, ruins, rocks, snow structures, or volcanic silhouettes; keep the lane near y=500..560 low contrast. The code-drawn floor strip and line remain visible above them.
  - `town-frontier-square.png` depicts the approved frontier-town square; `pvp-stone-arena.png` depicts the approved stone duel arena. These include background depth in one static composition.
  - All 17 images use the approved soft painterly style, no characters/creatures, text, UI, labels, logos, or watermark. Avoid hard comic outlines, detailed high-contrast ground clutter, and repeating landmarks that reveal tile seams.
- **Execution Flow / Logic**:
  1. Precondition & Validation: use the soft painterly comparison sample as style reference and the five approved theme descriptions as the full content brief. Generate each of the 17 distinct images separately with the built-in image generator; use transparent output for each mid/front tile. Copy selected final images into the exact project paths above.
  2. Core Processing: keep the floor lane open, separate each tile's foreground silhouette with alpha, and align repeated tile edges so adjacent copies join without a visible vertical seam. Fit/crop source outputs to the logical target canvas while preserving aspect ratio; do not non-uniformly stretch recognizable buildings or trees.
  3. Error & Exception Handling: reject any missing theme/layer, opaque mid/front background, obvious tile seam, illegible high-detail floor, off-theme composition, or exported dimensions that cannot fill their logical canvas. Rework only the failing layer and inspect it at the 1280×720 game scale.
  4. State Transition & Return: asset task returns 17 production PNGs ready for the T02 manifest; no scene loading or game behavior changes in this Task.

### I02. Background manifest and asset checks

- Related Files:
  - `src/game/ui/sceneBackgroundAssets.js` :: `BATTLE_BACKGROUND_THEMES`, `BACKGROUND_ASSETS`, `getBattleBackgroundAssetKeys` — stable scene theme/file mapping; new
  - `test/background-assets.test.js` :: file completeness, logical dimensions, tile alpha, and manifest checks; new

#### Details
- **Signatures & Types**:
  ```js
  export const BATTLE_BACKGROUND_THEMES; // readonly string[5], ordered as approved
  export const BACKGROUND_ASSETS; // readonly { battle: Record<Theme,{far,mid,front}>, town:string, pvp:string }
  export function getBattleBackgroundAssetKeys(theme); // -> { far:string, mid:string, front:string }
  ```
- **Execution Flow / Logic**:
  1. Map each battle theme/layer to the corresponding `/assets/backgrounds/...` path and stable Phaser key `background-${theme}-${layer}`. Static keys are `background-town-frontier-square` and `background-pvp-stone-arena`.
  2. Validate unknown themes with `RangeError`; never silently fall back to a different theme.
  3. Tests verify 5×3 battle records + 2 static records, every path exists, far logical dimensions are 4,800×560, tiles are 1,280×560 with alpha, and static images are 1,280×720.

## Acceptance Criteria
- [ ] All 15 battle layer images and both static backgrounds exist at the manifest paths.
- [ ] Battle far layers cover the 4,800px world; mid/front layers repeat seamlessly with transparent cutouts.
- [ ] Every theme has a visually distinct approved environment and leaves the floor lane readable at game scale.
- [ ] Manifest contains no missing/duplicate keys and asset tests validate dimensions, alpha and file existence.

## Validation
- `node --test test/background-assets.test.js` — all 17 PNG files, dimensions, tile alpha, theme names and manifest paths validate.
- `npm run build` — manifest module is importable by the Vite bundle.
- Visual review at 1280×720 — inspect every panorama, both tile joins, Town/PvP compositions and the y=560 floor lane.

## Commit Message
```text
feat(art): add painterly scene backgrounds

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P03-scene-backgrounds
Task: T01-background-art-assets

- Add five layered battle themes and seamless parallax tiles
- Add static frontier-town and stone-arena backgrounds
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
