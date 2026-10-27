# Task: T01 중립 기수 베이스와 슬롯별 레이어 정렬

## 최신 결정: 장비 조합을 기준으로 캐릭터 구성

기본 갑옷 외형을 기준으로 기수 underlay를 다시 만들고 완성된 인물은 Common 부위를 포함한 여섯 장비 레이어 조합으로 그린다. 장비 변경은 각 슬롯 이미지 교체로 처리한다. 레이어는 같은 프레임 안에 포즈별 위치로 정렬하고, 방향은 한 합성 그룹으로 반전한다. 전체 캔버스가 바뀌어 기준 좌표와 어긋난 이미지 생성 시안은 적용 대상에서 제외한다.

## Status: done

## Goal
기수 걷기/전투 베이스의 중복 장비를 제거하고, 각 장비 레이어를 목표 신체 부위 크기와 위치로 합성해 첨부 화면의 oversized/overlap 현상을 없앤다.

## Decision Summary
- 6부위×5희귀도 PNG, 희귀도 장식, 12칸 atlas 순서는 보존한다. 전투/걷기 베이스만 비무장 기수로 교체한다.
- 사용자 화면에서 기존 슬롯별 공통 런타임 변환은 크기와 위치가 맞지 않았다. 원본의 희귀도 그림을 보존하고 포즈별 위치를 프레임 atlas에 미리 합성한다.

## Implementation

### I01. 장비 없는 걷기·전투 기수 베이스

- Related Files:
  - `public/assets/walk/knight-rider.png` :: `WholeBodyWalk` 고정 기수 이미지 — 같은 포즈/투명 캔버스의 비무장 기수로 수정; modify
  - `public/assets/walk/knight-actions.png` :: `BattleScene` 6-frame mounted action sheet — 투명 atlas/포즈 순서 유지, 기수의 투구·갑옷·장갑·장화·창을 제거; modify
  - `public/assets/walk/knight-actions.json` :: `contentHeight`, `ground`, `frameCount` — action atlas metadata; modify
  - `src/game/ui/WholeBodyWalk.js` :: `WALK_CHARACTERS.knight.rider`, `WholeBodyWalk` constructor — rider alpha-bound scale; modify
  - `test/equipment-appearance-assets.test.js` :: rider/action PNG 크기·알파·접지선 검사 — modify

#### Details
- **Asset contracts**:
  - `knight-rider.png`: 최종 1205×1305 RGBA 투명 캔버스. 장비 없는 앉은 기수의 머리카락·얼굴·파란 천 튜닉·바지·맨손과 천 신발만 남긴다. alpha≥32 유효 실루엣 높이는 989px이다. `WholeBodyWalk.js`는 `rider.contentHeight:989`와 target height 150px, x=8, y=-100, origin=[.64,.66]을 사용한다.
  - `knight-actions.png`: 최종 512×768 RGBA, 2열×3행, 프레임 256×256. imagegen 1024×1536 출력을 전체 1/2 크기로 고품질 축소한다. alpha<48 픽셀을 완전히 투명하게 한다. 각 셀 내부 콘텐츠의 하단을 y=244에 맞춰 atlas 안에서 이동한다(프레임 순서별 y shift: -9,-10,-6,-6,+28,+32). 이 오프라인 atlas 정렬로 기존 runtime animation과 `ground=244`를 유지한다. `knight-actions.json`의 contentHeight는 188, ground는 244, frameCount는 6이다.
  - 기존 `knight-standing.png`와 모든 `public/assets/gear/{slot}-{rarity}.png` 파일은 수정하지 않는다.
- **Execution Flow**:
  1. `image_gen` 편집 시 위 로컬 참조 이미지를 사용한다. 최종 캔버스·격자·투명 알파를 맞추고 alpha thresholding과 atlas 내 action-cell 재배치만 후처리한다.
  2. action cells는 y=244 baseline을 맞춘 뒤 앱 원본 경로에 반영한다. PNG dimension/color-type/alpha 및 frame-bottom test를 통과시킨다.
  3. 시각 검토에서 여섯 action frame에 헬멧·판금·창이 베이스에 남아 있지 않고, 말이 잘리지 않으며 프레임 간 몸체 크기·접지가 유지되는지 확인한다.

### I02. 포즈별 장비 atlas와 renderer

- 기존 30개 gear sheet의 부위 그림을 포즈별 기준점에 재배치하는 scripts/build-equipment-appearance.ps1로 public/assets/gear-aligned atlas 30개를 생성했다. atlas frame 0-3은 걷기, 4-9는 전투, 10은 마을, 11은 투명 padding이다.
- equipmentAppearanceAssets.js에서 생성된 파일을 불러오고 equipmentAppearance.js는 공통 anchor의 컨테이너로 부위를 합성한다. 기수와 같은 기준으로 그룹 전체를 좌우 반전하며 걷기와 액션 스프라이트의 크기 차이를 반영한다.
- Battle, PvP와 마을의 기존 장비 데이터, 슬롯 순서 및 화면 배치는 유지한다. PNG 프레임의 실제 알파 범위, 좌우 반전 및 포즈 전환을 확인한다.
- 사용자 제공 전투/마을 스크린샷의 분리 현상을 수정하고 합성 이미지 검토와 실제 화면 확인을 별도로 기록한다.

## Acceptance Criteria
- [x] Base walk/action rider has no pre-painted slot equipment or spear; transparent canvas/frame sizes and action ordering remain valid.
- [x] All 6 mounted slots use pose-aligned atlas frames across both directions, 4 walk frames and 6 action frames.
- [x] Town horse and standing knight use separate aligned frames; original gear PNGs and rarity colors remain unchanged.
- [x] Battle, PvP and Town use the same pose-aligned layer renderer; no stats, save schema, combat simulation or ticket payload changes.

## Validation
- `node --test test/equipment-appearance-assets.test.js test/equipment-appearance.test.js test/knight-animation.test.js test/whole-body-walk.test.js test/pvp/character-appearance.test.js` — asset contracts, per-slot transform/frame behavior and snapshot mapping pass.
- `npm run build` — Battle/Town/PvP layout imports bundle successfully.
- Offline composites from the real base and equipment atlases were reviewed for Common, intermediate and Legendary rarities, 4 walk frames, 6 action frames, Town knight/horse. Browser manual confirmation at `http://localhost:5173/` was unavailable in this session.
- `git diff --check` — no whitespace errors.

## Commit Message
```text
fix(gear): align mounted equipment layers

Plan: 2026-10-27-equipment-layer-alignment
Phase: P01-layer-alignment
Task: T01-neutral-rider-and-layer-layout

- Replace the fully armored rider base with a neutral underlay
- Align all six gear slots across mounted and Town views
```

## Progress
- 기본 갑옷과 비무장 기수를 기준으로 여섯 슬롯 레이어를 결합하는 방향을 유지했다. 캔버스 전체를 다시 그려 위치가 달라진 ImageGen 분리 시안은 검토용으로만 보관한다.
- 기존 gear atlas의 원본 부위와 희귀도 색을 보존하고, 4개 걷기 + 6개 전투 + Town 포즈마다 적합한 곳에 합성하도록 30개 aligned atlas를 생성했다.
- 합성 시안에서 walk, 6 action, Town 기사와 말, Common 및 희귀도별 장비 모습을 모두 시각 확인했다. 사용자 브라우저에서의 실제 화면 확인은 미실행이다.
- [x] 구현 완료
- [x] 검증 통과
- focused tests: 36/36; Vite build passed; git diff --check passed
- offline visual composites reviewed; live browser review deferred
- commit: recorded in branch history
