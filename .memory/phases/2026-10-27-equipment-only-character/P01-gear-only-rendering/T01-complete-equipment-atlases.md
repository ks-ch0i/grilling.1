# Task: T01 완전한 장비 슬롯 atlas 제작

## Status: pending

## Goal
여섯 슬롯 각각이 맡은 전체 신체 부위를 포함하도록 30개 투명 atlas를 다시 제작한다. 어느 atlas도 별도 기사/말 베이스 없이 지정 신체 부위와 장비를 그릴 수 있어야 한다.

## Decision Summary
- 런타임 manifest 경로 `/assets/gear-aligned/{slot}-{rarity}.png`와 12프레임 atlas 계약은 유지한다. 슬롯 그림체는 현재 게임의 굵은 외곽선, 셀 셰이딩, 금속 하이라이트와 기존 희귀도 색/장식을 따른다.
- 출력은 6슬롯×5희귀도 PNG 30개다. 프레임 0–3 걷기, 4–9 전투, 10 마을 입상, 11 투명 패딩이며 256×256 프레임 2열×6행의 512×1536 RGBA 캔버스다.

## Implementation

### I01. 완전한 슬롯 아트와 atlas

- Related Files:
  - `public/assets/gear-aligned/helmet-{common,uncommon,rare,unique,legendary}.png` :: 머리·얼굴을 포함하는 투구 레이어; modify
  - `public/assets/gear-aligned/armor-{common,uncommon,rare,unique,legendary}.png` :: 상의·하의를 함께 포함하는 갑옷 레이어; modify
  - `public/assets/gear-aligned/gloves-{common,uncommon,rare,unique,legendary}.png` :: 손목 아래 팔·손을 완성하는 장갑 레이어; modify
  - `public/assets/gear-aligned/boots-{common,uncommon,rare,unique,legendary}.png` :: 발목 아래 다리 마감·발을 완성하는 장화 레이어; modify
  - `public/assets/gear-aligned/spear-{common,uncommon,rare,unique,legendary}.png` :: 독립 창 레이어; modify
  - `public/assets/gear-aligned/horse-{common,uncommon,rare,unique,legendary}.png` :: 말 전신과 전신 갑주를 함께 포함하는 말 레이어; modify
  - `public/assets/gear/helmet-{rarity}.png`, `armor-{rarity}.png`, `gloves-{rarity}.png`, `boots-{rarity}.png`, `spear-{rarity}.png`, `horse-{rarity}.png` :: 동일 슬롯의 선화·희귀도 색 참고; read-only
  - `public/assets/walk/knight-rider.png`, `public/assets/walk/knight-actions.png`, `public/assets/walk/knight.png` :: 캐릭터 비율과 포즈 순서 참고; read-only
  - `scripts/build-equipment-appearance.ps1` :: 잘린 독립 아이템 조각을 다시 출력해 새 완전 슬롯 atlas를 덮어쓰지 않도록 기존 overlay 전용 생성 경로 제거 또는 완전 슬롯 원본에 안전하게 맞춤; modify

#### Details
- **Asset contract**:
  - 각 PNG는 8-bit RGBA, 512×1536, 2열×6행, 셀 256×256이다. 0–3 walk, 4–9 action, 10 town, 11 모든 픽셀이 alpha=0인 padding이다.
  - 투구는 각 프레임에서 머리 전체 실루엣과 얼굴 영역을 포함하고, 불투명 전면 투구판이 얼굴을 덮는다. 머리카락이나 얼굴이 투구 구멍을 통해 보이는 디자인은 사용하지 않는다.
  - 갑옷은 한 슬롯 이미지 안에 상체/몸통, 손목까지의 소매, 골반 아래 하의/다리 외형을 포함한다. 하의 끝은 발목이다. 갑옷 프레임은 `origin=[0.5,244/256]`와 공통 축척에서 다른 기사 부위와 결합될 크기여야 한다.
  - 장갑은 손목에서 손끝까지 양팔/손을, 장화는 발목부터 발바닥까지 양다리/발을 완성한다. 옷/갑옷과 경계에 빈 투명 띠를 만들지 않는다.
  - 말 atlas는 목·머리·몸통·꼬리·네 다리를 포함한 말 전체에 해당 희귀도의 전신 갑주를 결합한다. 현재 말 이미지/갑주 아이템만 남기는 조각은 허용하지 않는다.
  - 창은 신체 픽셀 없이 창 전체를 그린다. 걷기와 공격 포즈의 기울기 및 facing 방향은 기존 프레임 순서를 보존한다.
  - 각 action 셀의 합성 접지는 기존 `ground=244`와 일치한다. 희귀도별 실루엣/공통 관절 기준은 일치시키고, 원래 희귀도 색과 작은 장식만 해당 레이어 안에 반영한다.
- **Execution Flow**:
  1. 구현 시작 전 `test/equipment-appearance-assets.test.js`에 슬롯별 프레임 0 신체 영역 최소 폭/높이 검증을 추가한다. 임계값은 helmet 60×60, armor 80×100, gloves 30×50, boots 45×70, spear 100×12, horse 150×100 픽셀로 설정하고 기존 atlas가 실패하는지 확인한다. 이 값은 온전한 부위 크기를 잡는 하한이며, 최종 판단은 합성 시각 검토로 한다.
  2. `imagegen`으로 기존 gear 원본과 walk/action 참조를 사용해 30개 투명 atlas를 슬롯별로 제작한다. 셀 격자, 투명 바탕, 기존 라인/음영/희귀도 룩을 프롬프트에 고정한다. 출력 크기가 달라지면 프레임을 수동으로 맞춘 새 source atlas만 산출물로 반영하고, 셀 경계에서 잘린 프레임은 승인하지 않는다.
  3. 재생성 스크립트가 예전 item-only crop을 새 파일에 덮어쓰지 않게 갱신한다. 수동 아트 산출물을 보존할 수 없는 기존 경로라면 해당 overlay 전용 builder를 제거한다.
  4. 프레임별 RGBA 차원/알파/비어있지 않은 내용, 슬롯별 픽셀 하한을 테스트한다. Common 전체 조합, 혼합 희귀도 조합, Legendary 조합을 걷기 4·전투 6·Town에서 오프라인 합성하여 관절 분리, 서로 다른 스케일, 말 중복, 셀 밖 잘림, 깨지는 방향을 눈으로 확인한다.

### I02. asset 계약 테스트

- Related Files:
  - `test/equipment-appearance-assets.test.js` :: PNG 디코더, 30개 asset 및 프레임 계약 검사; modify

#### Details
- 테스트는 PNG의 폭/높이/color type, 12개 프레임에서 alpha 존재 여부, padding 프레임 전체 투명 여부를 검사한다.
- 각 슬롯 Common atlas frame 0은 I01에 명시한 픽셀 하한을 만족해야 한다. 모든 30개 atlas의 frame 0–10은 비어 있지 않아야 한다.
- 픽셀 하한 테스트는 부위 누락을 빠르게 잡는 회귀 장치다. 얼굴 가림, 사람/말 전신 완성, 희귀도 룩, 동작 간 포즈 연결은 수동 합성 검토로 판정한다.

## Acceptance Criteria
- [x] 여섯 슬롯의 30개 atlas가 12-frame RGBA 계약을 지키고 11번째 padding frame이 투명하다.
- [x] Helmet, armor, gloves, boots, horse atlas가 별도 base 없이 해당 캐릭터 신체 영역 전체를 맡으며, spear는 창 외형만 포함한다.
- [x] 4 walk, 6 action, town 프레임에서 Common/혼합/Legendary 합성을 눈으로 확인했다.
- [x] 기존 overlay-only 생성 경로를 4×3 투명 원본에서 완전 슬롯 atlas를 만드는 결정적 builder로 교체했다.

## Validation
- `node --test test/equipment-appearance-assets.test.js` — 5/5 통과; 30개 PNG 차원·알파·슬롯 실루엣 하한 검사 포함.
- `git diff --check` — 공백 오류 없음.
- Common/혼합 희귀도/Legendary 전체 합성 미리보기는 `references/previews/{common,mixed,legendary}-composite.png`; 좌우 Town 미리보기는 `references/previews/common-town-side-by-side.png`에서 확인했다.
- `scripts/build-equipment-appearance.ps1`를 다시 실행해 30개 atlas를 재생성하고 계약 테스트를 재통과시켰다.

## Commit Message
```text
feat(art): build complete equipment character layers

Plan: 2026-10-27-equipment-only-character
Phase: P01-gear-only-rendering
Task: T01-complete-equipment-atlases

- Include the assigned anatomy in each equipment slot atlas
- Preserve rarity styling and walk, action, and Town frame contracts
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: this task's planned commit
