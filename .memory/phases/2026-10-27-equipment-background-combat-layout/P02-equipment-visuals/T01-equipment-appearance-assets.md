# Task: T01 Equipment Appearance Assets

## Status: pending

## Goal
각 장비 부위·희귀도 조합에 대해 투명 배경의 프레임 정렬 레이어를 만들고, 마을용 전신 입상 기사 베이스를 추가한다. 이후 렌더러가 장비 ID나 수치가 아니라 슬롯·희귀도만으로 아트를 선택할 수 있게 한다.

## Decision Summary
- 슬롯은 `helmet, armor, gloves, boots, spear, horse`, 희귀도는 `common, uncommon, rare, unique, legendary`다. 각 조합은 하나의 공유 외형으로 모든 아이템 레벨/능력치에 재사용한다.
- 사용자 확정: 장비 외형 파일 하나에 걷기 4컷과 공격·피격·쓰러짐 6컷을 함께 넣는다. 마을 기본 입상 기사는 별도 이미지 파일로 둔다.
- 사용자 확정: 마을 장착 미리보기를 위해 각 장비 파일에 서 있는 포즈용 레이어 1컷을 추가한다. atlas는 2열×6행, 프레임당 256×256px RGBA이며 11번째 컷은 마을 레이어, 마지막 칸은 투명 패딩이다.

## Implementation

### I01. 장비 시트 및 입상 기사 이미지 생성

- Related Files:
  - `public/assets/gear/helmet-common.png` through `public/assets/gear/horse-legendary.png` :: six slots × five rarities — transparent overlay sheets; new
  - `public/assets/gear/knight-standing.png` :: standalone 256×256 transparent full-body knight base for the TownScene preview; new
  - `public/assets/walk/knight.png` :: 4-frame horse locomotion atlas — read-only style/alignment reference
  - `public/assets/walk/knight-rider.png` :: static mounted rider — read-only style/alignment reference
  - `public/assets/walk/knight-actions.png` :: 6-frame mounted contact/hit/defeat atlas — read-only style/alignment reference

#### Details
- **Signatures & Types**:
  ```js
  // image asset contract; the manifest is implemented in I02 below.
  // Each gear PNG: 512x1536, RGBA8, frameSize=256, 2 columns x 6 rows.
  // Frame roles by row-major index:
  // 0..3 = walk frames matching knight.png frames 0..3
  // 4..9 = action frames matching knight-actions.png frames 0..5
  // 10 = TownScene standing-pose equipment overlay
  // 11 = fully transparent reserved frame
  ```
- **Data & Asset Names**:
  - Create exactly 30 sheet paths using `public/assets/gear/{slot}-{rarity}.png` where slot is one of `helmet|armor|gloves|boots|spear|horse` and rarity is one of `common|uncommon|rare|unique|legendary`.
  - Create `public/assets/gear/knight-standing.png`, a single 256×256 transparent, front/three-quarter full-body standing knight with no spear and no slot-specific helmet/armor/gloves/boots, so the five human-slot overlays remain visible. Preserve the established knight sprite's bold outlines, clean shapes, silver/blue/gold palette, and cel shading.
  - Every sheet preserves the underlying base artwork's alignment and transparent canvas. Human slots cover only their equipped part; `horse` covers only horse armor. Do not include labels, text, UI, borders around the whole cell, cast shadows outside the equipment, or watermarks.
  - Keep base item colors and add the existing rarity colors as restrained trim/decor/glow: common `#858b91`, uncommon `#f2f2f2`, rare `#4294ff`, unique `#b45cff`, legendary `#ffcf45`. Rarity changes decoration/color only; the silhouette remains the same for a slot.
- **Execution Flow / Logic**:
  1. Precondition & Validation: use the checked-in knight sheets as style and pose references. Generate each of the 30 distinct slot/rarity sheets separately with the built-in image generator; also generate the standing base separately. Copy selected production outputs into `public/assets/gear/`, never leave an asset used by code only under the generated-images directory.
  2. Core Processing: create row-major 256px cells with 4 locomotion poses, 6 action poses, 1 standing-preview overlay, and 1 all-transparent padding cell. The four locomotion human layers stay in the fixed rider pose currently used by `WholeBodyWalk`; horse armor follows the four horse frames. The six action layers align to contact frames 0–1, hit frames 2–3, and defeat frames 4–5 in `knight-actions.png`. The standing overlay aligns to the separate `knight-standing.png` base.
  3. Error & Exception Handling: reject any sheet that lacks an alpha channel, has dimensions other than 512×1536, omits an atlas cell, clips at a 256px cell boundary, or shifts the bottom/anchor relative to its base pose. Regenerate or correct only the affected asset; do not hide misalignment with per-frame runtime offsets.
  4. State Transition & Return: after visual review, all 30 named sheets and the standing base are committed as source assets; no runtime loading or scene behavior is changed in this Task.

### I02. Asset manifest and binary contract checks

- Related Files:
  - `src/game/ui/equipmentAppearanceAssets.js` :: `EQUIPMENT_SLOTS`, `EQUIPMENT_RARITIES`, `EQUIPMENT_APPEARANCE_FRAMES`, `EQUIPMENT_APPEARANCE_ASSETS`, `equipmentAppearanceTextureKey` — stable key/path/frame contract; new
  - `test/equipment-appearance-assets.test.js` :: manifest completeness and PNG geometry tests; new

#### Details
- **Signatures & Types**:
  ```js
  export const EQUIPMENT_SLOTS; // readonly ['helmet','armor','gloves','boots','spear','horse']
  export const EQUIPMENT_RARITIES; // readonly ['common','uncommon','rare','unique','legendary']
  export const EQUIPMENT_APPEARANCE_FRAMES; // readonly { frameWidth:256, frameHeight:256, frameCount:12, walk:[0,1,2,3], action:[4,5,6,7,8,9], town:10, padding:11 }
  export const EQUIPMENT_APPEARANCE_ASSETS; // readonly 30 records { slot, rarity, key, path }
  export function equipmentAppearanceTextureKey(slot, rarity); // -> `gear-${slot}-${rarity}`
  ```
- **Execution Flow / Logic**:
  1. Generate the 30 manifest records in slot-major, rarity-minor order. `key` is `gear-${slot}-${rarity}` and `path` is `/assets/gear/${slot}-${rarity}.png`.
  2. Validate helper inputs against the exported slot/rarity lists; invalid values throw `RangeError` rather than producing an undefined texture key.
  3. The Node test reads each PNG from `public/assets/gear`, verifies PNG signature, width 512, height 1536, bit depth 8 and color type 6 (RGBA), and confirms the transparent padding frame is present in the texture contract.

## Acceptance Criteria
- [ ] Exactly 30 named slot/rarity sheets and `knight-standing.png` exist under `public/assets/gear/`.
- [ ] Every sheet has 12 aligned 256×256 frames in the documented order, alpha transparency, and the existing rarity palette accents.
- [ ] The manifest exposes one stable texture key/path for every slot/rarity pair and no level/stat-dependent lookup.
- [ ] The asset test fails on a missing sheet, invalid dimensions, non-RGBA PNG, invalid key, or incomplete slot/rarity product.

## Validation
- `node --test test/equipment-appearance-assets.test.js` — all 30 sheet files, PNG dimensions/alpha and manifest records validate.
- `npm run build` — manifest module is importable by the browser bundle.

## Commit Message
```text
feat(art): add equipment appearance sheets

Plan: 2026-10-27-equipment-background-combat-layout
Phase: P02-equipment-visuals
Task: T01-equipment-appearance-assets

- Add 30 transparent slot and rarity sheets
- Add a standalone knight preview base and frame manifest
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
