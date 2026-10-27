# Task: T01 Common 기마 샘플 제작 및 사용자 확인

## Status: done

## Goal
투구·갑옷·장갑·장화·창·말 장비만으로 조립되는 자연스러운 Common 기마 기사 1컷을 만들고, 완성 이미지와 분리한 장비 조각을 재합성한 이미지를 사용자가 확인한다.

## Decision Summary
- 먼저 완성된 하나의 자세를 기준으로 장비 조각을 제작한다. 슬롯별 이미지를 각자 확대·이동해 대강 붙이는 방식은 사용하지 않는다.
- 각 슬롯은 필요하면 앞/뒤 조각으로 나눈다. 조각 자체가 최종 캐릭터를 구성하며 별도 기사·말 베이스는 런타임에 표시하지 않는다.
- 사용자의 샘플 확인이 후속 확장의 선행 조건이다. 확인되지 않은 시안을 완료 처리하지 않는다.

## Implementation

### I01. 원본 자세와 분리 가능한 부위

- Related Files:
  - `.memory/decisions/2026-10-28-coherent-equipment-character.md` :: 결정; read-only
  - `.memory/decisions/2026-10-27-equipment-only-character.md` :: 부위와 장면 범위; read-only
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/` :: 기준 그림, 투명 조각, 합성·검토 자료; new
  - `public/assets/gear/*` 및 `public/assets/walk/knight-rider.png` :: 선화·색과 캐릭터 참고; read-only
  - `scripts/build-equipment-appearance.ps1` :: 현 문제의 독립 크기 조절 방식; read-only

#### Details
- **Asset contract**: 기준 그림과 각 조각은 동일한 256×256 투명 RGBA 캔버스와 공통 좌표계를 쓴다. 부위는 `helmet`, `armor`, `gloves`, `boots`, `spear`, `horse`이며 Common을 사용한다. 슬롯별 `back`과 `front` 투명 조각을 각각 준비하고, 사용하지 않는 조각은 완전히 투명하게 둔다. 파일명은 `sample-{slot}-{back|front}.png`, 기준 그림은 `sample-master.png`, 재합성은 `sample-composite.png`다.
- **권장 합성 순서(뒤→앞)**: `horse-back`, `spear-back`, `armor-back`, `boots-back`, `gloves-back`, `helmet-back`, `horse-front`, `armor-front`, `boots-front`, `spear-front`, `gloves-front`, `helmet-front`. 그림에 맞지 않으면 사용자에게 보여주기 전에 순서와 조각을 조정하고 최종 순서를 `sample-layer-order.json`에 기록한다. 항목은 `{ "slot": "horse", "part": "back" }` 형태의 배열이며 6슬롯 × 2파트를 각각 정확히 한 번 포함한다. T02는 승인된 순서를 그대로 사용한다.
- **시각 기준**: 투구가 얼굴 전면을 가리고, 몸통과 팔이 손목까지 이어지며 하의와 다리는 발목까지 이어진다. 장갑·장화는 각각 손과 발을 완성한다. 전신 갑주를 입은 말에 기수가 실제로 앉아 있고 손으로 창을 잡는다. 겹치는 부위의 실루엣·가림·크기·선이 자연스럽고 끊기거나 중복된 몸, 떠 있는 장비, 잘린 창이 없어야 한다.
- **Execution flow**:
  1. 이미지 생성 도구로 현재 그림체를 참고해 완성된 기마 자세 1컷을 만들고 정해진 공통 좌표에서 슬롯 조각을 제작한다. 필요한 앞/뒤 조각은 동일 좌표계에 남긴다. 없는 부분을 다른 슬롯의 몸이나 별도 베이스로 메우지 않는다.
  2. 12개 조각을 `sample-layer-order.json` 순서대로 합성하고 완성본·재합성본·슬롯별 조각을 함께 검토한다. 가장자리, 투명 배경, 손과 창, 안장과 다리, 말 앞뒤 가림을 확인한다. 재합성은 샘플 완성본의 형태를 보존해야 한다. 실패하면 조각을 다시 제작한다.
  3. 사용자에게 실제 `sample-master.png`, `sample-composite.png`, 조각별 확인 자료를 보여주고 결과 확인을 요청한다. 거부되면 이 Task를 계속 수정한다. 명시적 확인 전에는 T02에 착수하거나 이 Task를 `done`으로 표시하지 않는다.
  4. 확인 내용을 `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/approval.md`에 날짜와 승인된 파일명으로 기록하고 관련 산출물만 커밋한다. 승인 결과를 임의로 만들지 않는다.
- **Error handling**: 이미지 생성이나 분리 결과가 없거나 투명도·크기·순서가 틀리면 샘플을 완성했다고 표시하지 않는다. 조각이 동일 캔버스에 맞지 않으면 다시 제작한다.

### I02. 샘플 검증
- Related Files:
  - `.memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references/` :: 검토 자료; new

#### Details
- 완성본·재합성본·12조각이 모두 256×256 RGBA PNG인지 확인한다. 비어 있는 front/back 조각은 허용하지만 각 슬롯은 두 조각 중 최소 하나가 보여야 한다.
- 사용자가 볼 수 있는 이미지 파일로 완성본과 재합성본을 직접 제공한다. 크기 또는 비어 있지 않음 검사만으로 자연스러운 조립을 증명했다고 주장하지 않는다.

## Acceptance Criteria
- [ ] Common 기마 완성본, 12개 투명 조각, 합성 순서와 재합성본이 저장되어 있다.
- [ ] 사용자가 재합성 결과를 실제로 확인하고 확장에 동의했다.
- [ ] 런타임 에셋과 게임 코드는 아직 바뀌지 않았다.

## Validation
- `git diff --check` — 공백 오류 없음.
- PowerShell `Get-ChildItem .memory/phases/2026-10-28-coherent-equipment-character/P01-coherent-character/references` — 기준·조각·합성·순서·확인 기록 확인.
- 이미지 메타데이터 및 시각 검토를 수행하고 사용자 확인을 기록한다. 이 결과는 게임 화면 검증이 아니다.

## Commit Message
```text
feat(art): approve assembled mounted character sample

Plan: 2026-10-28-coherent-equipment-character
Phase: P01-coherent-character
Task: T01-approved-mounted-sample

- Create and review a common mounted character assembled from equipment
- Record the approved layer fragments and draw order
```

## Progress
- [x] 구현 완료
- [x] 검증 통과 및 사용자 확인
- commit: this task's planned commit
- 2026-10-28: 기준 그림과 장비별 추출 시안을 `references/drafts/`에 보관했다. 이미지 생성의 추출 결과는 창이 원래 위치보다 아래로 이동하고 갑옷 다리가 새로 그려져 공통 좌표 조건을 충족하지 못한다. 좌표를 명시한 창 재시도도 동일하게 이동했다. 이 시안은 재합성 완료본이 아니며 사용자 확인을 받은 결과가 아니다. 256×256 변환, 정확한 분리, 재합성, 검증과 확인이 남았다.
- 후속: 사용자가 코드 기반 마스크 분리를 허용하여 256×256 기준·12개 슬롯/파트 이미지·합성 순서·실제 재합성 이미지 및 슬롯 제거 검토 이미지를 만들었다. 12개 RGBA 크기, 6슬롯 유효 픽셀과 저장된 합성의 조각 합성 일치를 확인했다. `sample-composite.png` 및 `sample-inspection.png`를 사용자에게 제시하고 확인을 기다린다. 이 샘플은 Common 한 자세이며 다른 희귀도·포즈의 교체 호환성을 검증한 결과는 아니다.
- 사용자가 “어 진행해”라고 응답하여 샘플 기준 후속 제작을 확인했다. 세부 내용은 `references/approval.md`에 기록했다.
