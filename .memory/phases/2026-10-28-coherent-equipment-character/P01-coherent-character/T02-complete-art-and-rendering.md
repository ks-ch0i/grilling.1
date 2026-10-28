# Task: T02 장비 아트 전체 확장과 장면 렌더링 통합

## Status: done

## Goal
사용자가 확인한 기마 샘플을 기준으로 모든 동작과 희귀도에 장비 조각을 제작하고, 마을·일반/랭킹 전투·PvP에서 각 장비 조합이 자연스러운 완성 캐릭터로 보이게 한다.

## Decision Summary
- 시작 조건: `references/approval.md`에 T01의 실제 사용자 확인이 있어야 한다. 확인이 없으면 중단하고 샘플을 보여준다. 거부된 샘플을 기반으로 확장하지 않는다.
- 슬롯은 `helmet`, `armor`, `gloves`, `boots`, `spear`, `horse` 여섯 개다. 캐릭터는 이 장비 조각들로만 그린다. 동작마다 동일한 관절과 공통 좌표계를 사용한다.
- 걷기 0–3, 전투 4–9, 마을 10, 투명 패딩 11의 순서와 프레임 크기 256×256을 유지한다. 희귀도는 `common`, `uncommon`, `rare`, `unique`, `legendary`다.

## Implementation

### I01. 승인된 자세에서 모든 장비 시트 제작
- Related Files:
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/sample-master.png` :: 승인된 Common 기준 기마 이미지; read-only
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/sample-{slot}-{back|front}.png` :: 승인된 장비 조각; read-only
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/sample-layer-order.json` :: 확인된 12개 조각의 뒤→앞 순서; read-only
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/approval.md` :: 사용자 확인; read-only
  - `public/assets/gear-aligned/{slot}-{rarity}.png` :: 슬롯의 back atlas 30개; modify
  - `public/assets/gear-aligned/{slot}-{rarity}-front.png` :: 슬롯의 front atlas 30개; new
  - `scripts/build-equipment-appearance.ps1` :: 이전 독립 크기 맞춤으로 새 아트를 덮어쓰지 않도록 교체; modify

#### Details
- **Asset schema**: 각각 8-bit RGBA PNG, 512×1536, 2열×6행, 셀 256×256. 프레임은 0–3 걷기, 4–5 접촉/공격, 6–7 피격, 8–9 쓰러짐, 10 마을, 11 완전 투명. 모든 같은 프레임의 슬롯·파트는 공통 좌표로 제작하며 동일한 origin `[0.5, 244/256]`를 쓴다. 개별 이미지를 보이는 픽셀 경계로 잘라 다시 크기 조정하지 않는다.
- **Art contract**: 6슬롯 × 5희귀도 × 2파트 = 60 시트. 슬롯별 back/front 중 한쪽 프레임은 완전 투명해도 되지만 두 파트 합산에는 슬롯의 해당 프레임 그림이 있어야 한다. 모든 희귀도와 프레임은 동일한 포즈의 공통 관절, 외곽 경계, 크기 및 좌표를 따른다. 각 장비의 본래 색을 유지하고 희귀도는 기존 색의 작은 테두리·장식·은은한 빛으로 구분한다. 레벨/능력치는 외형에 영향이 없다.
- **Geometry**: 투구는 얼굴 앞을 가리는 머리, 갑옷은 팔목까지 상의와 발목까지 하의, 장갑은 손, 장화는 발, 말은 전신 갑주를 포함한 말 전체, 창은 무기만 포함한다. 기마 0–9는 말에 탄 기사이며 10은 말 전신 단독과 입상 기사 단독을 각 슬롯의 공통 좌표에 넣는다. 마을에서는 말과 기사 슬롯을 다른 컨테이너로 분리해 각각 표시한다.
- **Execution flow**:
  1. 승인 기록과 샘플 및 layer order를 확인하고 모든 포즈를 같은 캐릭터 체형과 관절 기준으로 제작한다. 0–9의 말·기사 접점, 창을 쥔 손, 방향과 전후 가림을 유지한다. 10은 기마가 아닌 입상 자세로 별도 제작한다.
  2. T01에서 확인된 Common 샘플 조각과 정렬을 기준으로 각 동작과 희귀도를 제작한다. 기준 이미지 전체를 단순 확대·복제하거나 포즈와 무관한 독립 아이템 이미지를 사각형에 끼워 넣어서는 안 된다.
  3. 생성된 원본과 실제 60 시트의 출처 및 조합 확인 자료를 작업 폴더에 보존한다. 빌더를 사용할 경우 공통 좌표를 그대로 복사하는 포장만 허용하고 독립적 bounding-box 자르기·리사이즈를 제거한다. 재실행이 최종 수동 아트를 망가뜨리면 실패해야 하며 기존 방식으로 조용히 덮어쓰지 않는다.
  4. Common 전체, Legendary 전체, 서로 다른 희귀도를 섞은 조합 및 슬롯 하나씩 바꾼 조합을 프레임 0–10에서 재합성해 검토한다. 잘림·겹침·빈틈·떠 있는 손/무기·말과 기사 분리·동작 간 신체 도약을 수정한다. 애니메이션은 재생 상태도 확인한다.
- **Error handling**: 이미지가 생성되지 않거나 어떤 조합에서 관절이 맞지 않으면 그 프레임·등급을 수정한다. 빈 파트의 투명 이미지를 허용하지만 슬롯 자체가 빈 경우 완료하지 않는다. 11번 패딩은 두 파트 모두 투명이어야 한다.

### I02. 로더와 다중 조각 렌더러
- Related Files:
  - `src/game/ui/equipmentAppearanceAssets.js` :: manifest, `equipmentAppearanceTextureKey`, preload 및 texture 검증; modify
  - `src/game/ui/equipmentAppearance.js` :: `EquipmentAppearance`와 `renderTownEquipmentPreview`; modify
  - `src/game/ui/pvpCharacterAppearance.js` :: PvP snapshot 검증과 기존 키 사용; read-only unless compatibility requires modification
  - `src/game/scenes/BootScene.js`, `BattleScene.js`, `PvpScene.js`, `TownScene.js` :: preload 및 프레임·장면 사용; read-only unless integration requires modification

#### Details
- **Signatures & types**:
  ```ts
  type Slot = 'helmet' | 'armor' | 'gloves' | 'boots' | 'spear' | 'horse';
  type Rarity = 'common' | 'uncommon' | 'rare' | 'unique' | 'legendary';
  type Part = 'back' | 'front';
  type Layer = { slot: Slot; part: Part };
  type Gear = { slot: Slot; rarity: Rarity } | null;
  type Equipment = Record<Slot, Gear>;
  function equipmentAppearanceTextureKey(slot: Slot, rarity: Rarity, part?: Part): string;
  // omitted part defaults to back; back keeps gear-{slot}-{rarity};
  // front key is gear-{slot}-{rarity}-front.
  class EquipmentAppearance {
    constructor(scene: object, parent: object, equipment: Equipment, options: object);
    setEquipment(equipment: Equipment): this;
    setFrame(frameIndex: number): this;
    setFacing(direction: 1 | -1): this;
    setVisible(visible: boolean): this;
    destroy(): void;
  }
  ```
- **Manifest**: `EQUIPMENT_APPEARANCE_ASSETS` 열거는 60개 유일한 `{slot, rarity, part, key, path}`를 반환한다. back path는 기존 `/assets/gear-aligned/{slot}-{rarity}.png`, front path는 `/assets/gear-aligned/{slot}-{rarity}-front.png`다. 잘못된 슬롯/희귀도/파트는 `RangeError`. 기존 2인자 texture key는 back 키를 반환해 PvP snapshot 유효성 검사와 기존 호출자를 유지한다.
- **Draw order**: 코드에 T01의 승인된 `sample-layer-order.json` 순서를 명시한다. 12개 `(slot,part)`의 순서를 보존하고 `slots` 옵션이 포함하는 슬롯의 조각만 생성한다. JSON의 모든 슬롯·파트가 정확히 한 번 있는지 확인한 후 사용한다. 모든 희귀도·프레임은 이 순서로 올바르게 조합되도록 아트를 제작한다.
- **Runtime flow**:
  1. Boot는 60개 시트를 로드하고 각 텍스처의 12개 프레임이 존재하는지 검사한다. 누락되면 기존 리소스 오류 화면을 사용한다.
  2. 생성자는 기존 기본 옵션 `origin=[0.5,244/256]`, `initialFrame=0`, `actionScale=scale`을 보존한다. 슬롯의 각 파트가 동일 `frameIndex`·origin·scale을 사용하게 한다.
  3. `setEquipment`는 업데이트를 적용하기 전에 모든 장착 슬롯의 희귀도를 검증한다. 같은 슬롯의 back/front 텍스처를 동시에 교체하고 현재 프레임과 `visible` 상태를 유지한다. null 슬롯은 두 파트 모두 숨긴다. 예외 발생 시 일부만 교체하지 않는다.
  4. `setFrame`은 0–10 정수만 수용하고 모든 파트에 반영한다. `setFacing`은 컨테이너 전체를 좌우 반전한다. `setVisible`과 `destroy`는 모든 파트에 적용하고 중복 destroy도 안전하다.
  5. 마을의 `renderTownEquipmentPreview`는 기존 좌표 `(556,118)`, `(628,118)`, scale `64/256`, frame 10, origin `[0.5,0.5]`를 유지하며 말 슬롯과 나머지 기사 슬롯을 각각 그린다. 장착 변경이 양쪽 미리보기 모두에 반영되는지 확인한다.
  6. Battle의 `getKnightEquipmentFrame`은 walk 0–3 및 action sprite 0–5 → 장비 4–9를 유지한다. PvP는 각 플레이어의 개별 장비 스냅샷과 방향을 사용한다. 기존 숨긴 pose driver는 유지하되 기사/말 베이스 픽셀은 그리지 않는다.
- **데이터 호환**: 저장 데이터 스키마, 장비 능력치, 전투 시뮬레이션과 티켓 계약을 바꾸지 않는다. 기존 null 슬롯도 안전하게 처리한다. 장착 장비 분해와 강화 파괴 복구 규칙은 이번 작업에서 바꾸지 않는다.

### I03. 회귀와 실제 화면 확인
- Related Files:
  - `test/equipment-appearance-assets.test.js` :: PNG·manifest 계약; modify
  - `test/equipment-appearance.test.js` :: Phaser mock과 조각 렌더링; modify
  - `test/town-profile-actions.test.js`, `test/pvp/character-appearance.test.js` :: 기존 장착 갱신과 PvP 계약; modify only if needed

#### Details
- PNG 검증은 모든 60개가 RGBA·512×1536이며 프레임 11이 완전 투명인지 확인한다. 한 파트의 빈 프레임은 허용하고 슬롯별 back/front 합산 0–10의 내용은 존재해야 한다.
- 로더와 Boot의 누락·오류를 검증한다. 렌더러는 확정 순서, 슬롯 두 파트의 동시 교체, 혼합 희귀도, null, invalid rarity의 원자적 실패, 현재 프레임 유지, 좌우 반전, visibility, destroy, 마을 분리를 검증한다.
- 정적 검사는 그림 품질을 판단하지 못한다. 실제 브라우저에서 마을 장착 변경, 일반 전투 걷기·접촉·피격·쓰러짐 및 양 방향, 랭킹 전투, PvP 양쪽의 조합을 확인하고 증거를 남긴다. 온라인 접근이나 연출 재현이 불가한 항목은 성공으로 적지 않고 남은 검증으로 보고한다.

## Acceptance Criteria
- [x] 사용자 확인을 받은 T01 샘플을 기반으로 60개 atlas가 제작되고 11개 포즈의 슬롯을 합성해 확인했다.
- [x] Common, Legendary, 혼합 희귀도 및 슬롯 변경 조합을 시각 검토했다.
- [x] 마을 좌우 미리보기와 일반 전투, 테스트 데이터로 연 랭킹 전투·PvP 양쪽에 장비 조합 캐릭터가 표시됐다.
- [x] 자동 검사와 로컬 장면 시각 검증 결과를 `references/qa-results.md`에 기록했다. 실제 서버 매칭·랭킹 판정은 검증하지 않았다.

## Validation
- `node --test test/equipment-appearance-assets.test.js test/equipment-appearance.test.js test/town-profile-actions.test.js test/pvp/character-appearance.test.js` — 관련 계약·렌더링 테스트 통과.
- `npm run build` — Vite 빌드 성공.
- `git diff --check` — 공백 오류 없음.
- `npm run dev -- --port 5174` — 브라우저에서 마을, 일반 전투 및 가능한 랭킹·PvP 화면을 시각 확인하고 스크린샷과 미검증 사유 기록. 기존 서버 사용 시 해당 URL과 브랜치를 먼저 확인한다.

## Commit Message
```text
feat(gear): assemble coherent equipment characters

Plan: 2026-10-28-coherent-equipment-character
Phase: P01-coherent-character
Task: T02-complete-art-and-rendering

- Extend approved equipment artwork across poses and rarities
- Render slot fragments in the approved order across game scenes
```

## Progress
- [x] 구현 완료
- [x] 검증 통과: 지정 테스트 19/19, 빌드, 60개 atlas 바이트 단위 재생성, `git diff --check`.
- [x] 로컬 마을·일반 전투와 테스트 데이터의 랭킹·PvP 화면, 장착 교체 및 동작 프레임 확인. 온라인 실서버 검증 제외.
- commit: this task's planned commit
