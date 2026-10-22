# Task: T04 장비 강화 실패·파괴·대성공

## Status: done

## Goal
장비 강화에 레벨별 실패·파괴 확률을 적용하고 재료 소모/장비 삭제를 처리한다. 강화 전에 현재 세 확률을 TownScene에 보여준다.

## Decision Summary
- 확률은 강화 시도 직전 item.level 기준이다. 실패와 파괴는 매 시도 독립 판정하며 파괴가 성공/실패 결과를 덮어쓴다.
- 파괴되지 않은 실패는 레벨/능력치를 유지한다. 모든 유효 시도는 재료를 소비한다. 대성공은 비파괴 정상 성공 후 5%로 확인한다.
- 희귀 장비의 stat-only/effect-only/both 무작위 선택과 기존 재료 비용 구조는 보존한다.

## Implementation

### I01. 결정적 강화 결과 domain
- Related Files:
  - src/game/domain/gear.js :: improveValue, upgradeItem, upgradeGear, getGearUpgradeCost — level-banded random result; modify.
  - src/game/data/balance.js :: T01 upgrade band exports — read-only.
  - src/game/domain/models.js :: GearItem — unchanged shape; read-only.

#### Details
- Signatures & Types:
  ~~~js
  upgradeGear(state: GameStateV2, itemId: string, rng?: () => number): {
    ok: boolean,
    reason?: 'item-not-found'|'max-level'|'insufficient-materials',
    state?: GameStateV2,
    outcome?: 'success'|'failed'|'destroyed',
    cost?: number,
    item?: GearItem,
    destroyedItem?: GearItem,
    failureChance?: number,
    destructionChance?: number,
    greatSuccessChance?: number,
    greatSuccess?: boolean
  }
  ~~~
- Execution Flow / Logic:
  1. 아이템 위치/equipment slot, 레벨<30, 강화 재료 >= getGearUpgradeCost(level)을 먼저 검사한다. 실패 사전조건이면 RNG/상태를 소비하지 않는다.
  2. item.level에 해당하는 T01 밴드를 읽고 destructionRoll과 failureRoll을 순서대로 각각 한 번 호출해 독립 판정한다. 두 RNG draw는 매 유효 시도에서 모두 한다.
  3. 파괴가 참이면 재료를 빼고 장착 슬롯을 null로, 또는 인벤토리에서 항목을 제거한다. 결과 outcome='destroyed'이며 destroyedItem에 이전 장비를 반환한다.
  4. 비파괴 실패면 재료만 빼고 동일한 장비 객체 값/레벨을 보존한다. 결과 outcome='failed', greatSuccess=false다.
  5. 비파괴 성공이면 세 번째 RNG draw로 greatSuccessChance를 확인한다. 선택한 일반 능력치에는 해당 레벨 밴드의 굴림 비율을, 특수 능력치/효과에는 고정 증가량을 적용한다. 대성공이면 해당 시도에서 굴린 증가분만 2배다. 적용 후 critChance/damageReduction 상한을 지킨다.
  6. 정수 일반 능력치는 현재 규칙대로 올림 단위 증가량을 두 배하고, fractional 값은 소수점 6자리로 반올림한다. 결과 item.level만 1 올린다.

### I02. TownScene 확률/결과 표시
- Related Files:
  - src/game/scenes/TownScene.js :: selected gear upgrade panel, upgrade action handler, refresh — show odds and outcome; modify.
  - test/gear-upgrade.test.js :: independent RNG outcomes and material/item transitions; new.
  - test/town-gear-upgrade-ui.test.js :: odds and result messages; new if UI harness exists, otherwise extend current TownScene UI tests.

#### Details
- 강화 패널은 선택 장비 level 기준 실패/파괴 확률과 대성공 확률을 모두 강화 버튼 전에 표시한다. 최대 레벨, 재료 부족, 장비 미선택에서는 확률 대신 가능한 기존 사유를 보여준다.
- 성공/실패/파괴/대성공 메시지는 서로 구별한다. 파괴된 장비의 슬롯 해제/인벤토리 삭제를 즉시 다시 그린다. 기존 대성공 메시지에 수치 증가량을 추가하지 않는다.
- 결정적 RNG 테스트에서 파괴+성공, 파괴+실패, 비파괴 실패, 보통 성공, 대성공을 각각 검증한다. 동일 seed와 동일 상태는 같은 결과를 만들어야 한다.

## Acceptance Criteria
- [x] 1–30강 경계 확률이 T01 표와 일치한다.
- [x] 실패/파괴가 서로 독립적으로 적용되고 성공 상태에서도 파괴될 수 있다.
- [x] 실패·파괴·성공 모두 재료를 소비하며 비파괴 실패는 장비 값이 바뀌지 않는다.
- [x] TownScene에 시도 전 세 확률이 보이고 결과별 메시지/장비 목록이 맞게 갱신된다.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/gear-upgrade.test.js — 강화 RNG, 확률 경계, 자원/장비 전이가 통과해야 한다.
- npm run build — TownScene 강화 UI 빌드가 통과해야 한다.

## Commit Message
~~~text
feat(gear): add failed and destructive upgrades

Plan: 2026-10-22-character-gear-balance
Phase: P01-gameplay-and-save
Task: T04-gear-upgrade-outcomes

- Apply independent failure and destruction rolls by item level
- Show failure, destruction, and great success odds before upgrade
~~~

## Critical Review
- 독립 리뷰에서 장착 중 최대 HP 장비가 파괴될 때 현재 HP가 새 최대치를 넘는 P1 결함을 발견했다. 파괴 후 장비 기준 최대 HP로 현재 HP를 clamp하고, 회귀 테스트를 추가했다.
- 재리뷰에서 HP 수정과 회귀 테스트 해결을 확인했으며, 추가 차단 이슈는 없었다.
- RNG 순서/독립 판정, 확률 경계, 재료 전이, UI 피드백을 검토했다. TownScene 전용 테스트 harness는 없어 domain 테스트와 production build를 사용했다.

## Progress
- [x] 구현 완료
- [x] 검증 통과
- 지정 domain/balance 테스트: Node.js 22.12.0, 15/15 통과.
- 전체 테스트: 169개 중 157개 통과, 12개 실패. 실패는 schema v1 cloud save/ranking snapshot/stage ticket API fixture이며 P02-T06~T07에서 v2 호환성을 반영할 때 갱신한다.
- 빌드: Node.js 22.12.0 Vite production build 통과. 기존 500 kB chunk 크기 경고가 남아 있다.
- `git diff --check`: 통과.
- commit: pending (T04 변경과 메모리 포인터 동기화 후 커밋 예정)
