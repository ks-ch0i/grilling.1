# Task: T01 v2 공통 밸런스 표와 전투 목표 보정

## Status: done

## Goal
packages/game-rules의 공유 규칙을 결정문서의 v2 강화·전투 기준으로 갱신하고, 같은 seed로 전투 목표를 재현하는 자동 검증을 추가한다. 브라우저와 API가 같은 계산값을 쓰게 한다.

## Decision Summary
- 기준 문서는 .memory/decisions/2026-10-22-character-gear-balance.md D03-D06이다. 확률 구간은 시도 직전 레벨 1–5, 6–10, 11–15, 16–20, 21–25, 26–30이며 경계는 앞 구간에 포함된다.
- 전투 수치는 사용자 미정값이 아니라 구현 산출이다. 기존 접촉 피해 공식은 유지하고 BALANCE 값만 보정한다.
- 목표 평가용 기준 빌드는 공통 시작 장비 여섯 부위의 평균 굴림값 1.0, 강화 레벨 1, 특수효과 없음이다. D01은 능력치 포인트를 보유하고 쓰지 않을 수 있다고 정했으므로, 각 단계 비교는 같은 레벨 1 전투 스탯으로 수행해 적 성장 곡선만 분리 검증한다. 이는 보수적 밸런스 회귀 기준이다.
- 첫 스테이지 HP 표본은 같은 평균 시작 장비로 1,024개의 고정 seed를 순회해 적 7마리를 연속 처치한 뒤의 평균 HP 비율을 사용한다. 표본 seed는 `Math.imul(sample + 1, 0x9e3779b9) >>> 0`로 32비트 범위에 간격을 두어 생성한다. 평균값 목표는 30–50%다.
- C1S10 잔여 HP 목표도 동일한 레벨 1 빌드와 50% 시작 HP를 사용한다. 모든 목표를 동시에 만족시키기 위해 기본 최대 HP는 200(평균 시작 장비 장착 시 220), 적 공격력은 C1S1의 24에서 C1S10의 19로 완만히 낮추고, 적 체력·방어 성장으로 접촉 횟수를 늘린다. 이는 D05의 동일 빌드 비교 해석에서 나온 수치상 절충이다.

## Implementation

### I01. 공유 v2 밸런스 데이터
- Related Files:
  - packages/game-rules/src/balance.js :: BALANCE, getStageEnemyStats — 공통 값과 적 능력치 계산; modify.
  - src/game/data/balance.js :: 공유 밸런스 export adapter — BALANCE, getGearUpgradeBand를 그대로 전달하도록 추가; modify.
  - src/game/domain/progression.js :: getStageEnemyStats shared-rule adapter — 기존 export가 유지되는지 확인; read-only.

#### Details
- Data & Schema Fields:
  - BALANCE.basePlayer: maxHp, attack, defense, critChance, critMultiplier, moveSpeed. maxHp/attack/defense는 보정 대상이며 이동·치명타 기본 동작은 이전 결정과 호환한다.
  - BALANCE.levelUp: attack=5, defense=10, maxHp=30.
  - BALANCE.gearUpgrade.levelBands: 6개의 {minLevel,maxLevel,min,max,failureChance,destructionChance} 밴드. 구간별 일반 증가량은 1–5: .01–.05, 6–10: .02–.06, 11–15: .03–.07, 16–20: .04–.08, 21–25: .05–.09, 26–30: .06–.10. 실패 확률은 0, .05, .15, .30, .50, .70이며 파괴 확률은 0, .01, .03, .06, .10, .15다.
  - BALANCE.gearUpgrade.greatSuccessChance=.05, gearMaxLevel=30. 희귀도 배율은 common=1, uncommon=1.5, rare=2, unique=3, legendary=5. gearRollRange는 .75–1.25다.
  - BALANCE.gearUpgrade.specialIncrease는 결정문서 표를 그대로 반영한다. 치명타 확률과 피해감소 상한은 1; 치명타배율, 이동속도, 추가피해, 생명력흡수, 반사피해는 결정문서의 기존 상한 정책을 유지한다.
  - 적 수 4–10 랜덤 배정은 T05의 범위다. 이 Task에서는 기존 적 수 상수를 변경하지 않는다.
  - enemyBaseStats=`{maxHp:36,attack:24,defense:4}`, enemyStageGrowth=`{maxHp:.078,attack:-.025,defense:-.05}`, chapterGrowth=`{maxHp:.779,attack:.05,defense:.835}`, bossMultipliers=`{maxHp:1.68,attack:1.1,defense:2}`. 각 능력치는 `(1 + enemyStageGrowth[stat] * (stage - 1)) * (1 + chapterGrowth[stat] * (chapter - 1))`를 곱해 계산한다. 적 수 4–10 랜덤 배정은 T05 범위이며 이 Task에서는 기존 적 수 상수를 변경하지 않는다.
  - 밴드 선택은 level <= upperBound인 첫 항목을 사용한다. 입력은 1–30 정수만 허용하고 그 밖에는 RangeError를 발생시킨다.
  - 기준 HP 검증 측정값: C1S1 1,024/1,024 클리어, 평균 잔여 HP 39.7785%; C1S10 1,024/1,024 클리어, 평균 잔여 HP 8.2804%. 1,024 seed 중 첫 난수값이 기본 치명타 확률 10% 미만인 표본은 104개다.
- Signatures & Types:
  ~~~js
  getGearUpgradeBand(level: number): {
    min: number,
    max: number,
    failureChance: number,
    destructionChance: number
  }
  getStageEnemyStats(chapter: number, stage: number, isBoss?: boolean): EnemyStats
  ~~~
- Execution Flow / Logic:
  1. 기존 resolveContact 피해 계산식을 바꾸지 않는다. 기준 장비의 각 stat은 equipmentTemplates × common rarity × 1.0 평균 굴림으로 산출한다.
  2. 적 기본 체력/공격/방어, 능력치별 스테이지 성장률과 챕터 성장률, 보스 배율과 플레이어 기본 combat stats를 조정해 D05 목표를 만족시킨다. 전투 접촉은 packages/game-rules/src/combat.js의 resolveContact를 호출해 측정하며 crit은 표본 seed에서 그대로 재현한다.
  3. 단계별 접촉 수 비교는 평균 시작 장비를 착용한 레벨 1 플레이어로 고정한다. HP 목표는 stage clear 전, stage-heal 전의 실제 currentHp/maxHp다.
  4. 수치 계산 중 값이 음수/비유한수면 테스트가 즉시 실패하도록 한다. 결정문서에 없는 전투 공식 변경은 하지 않는다.
  5. 피해감소·치명타확률 상한, 100% 치명타 처리, 기존 생명력흡수 및 대성공 문구는 그대로 보존한다.

### I02. 재현 가능한 목표 테스트
- Related Files:
  - test/game-rules-balance.test.js :: new deterministic calibration and boundary tests.
  - test/game-rules-simulation.test.js :: old fixed constants and fixed enemy-count assertions; update to v2 values.

#### Details
- 평균 시작 장비를 착용한 레벨 1 플레이어는 C1S1 일반 적을 2–3회 접촉으로 처치한다. `Math.imul(sample + 1, 0x9e3779b9) >>> 0`로 생성한 1,024개 고정 seed 표본 모두 일반 적 7마리를 처치해야 하며, 평균 HP 잔량은 30–50%여야 한다.
- 평균 장비 레벨 1 빌드에서 C1S5 보스는 6–9회 접촉을 요구하며, 접촉 수는 같은 구간 일반 적의 약 2배(1.75–2.25배)다.
- C1S10 일반 적은 4–5회, C2S1은 5–6회, C2S10은 7–8회 접촉을 요구한다. C1S10과 C2S10은 각각 앞선 기준 구간보다 전투가 어려워야 한다. C3S1은 C2S10보다 접촉 수가 많다.
- C1S10 기준 HP 50%로 시작한 모든 고정 seed 표본은 일반 적 7마리와 보스를 처치해야 하며, 처치 후 평균 HP가 최대 HP 10% 미만이어야 한다.
- 각 강화 밴드의 1, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26, 30 레벨 경계와 0/31 무효 입력을 검증한다. 실패·파괴 확률의 독립 값과 특수 증가량 상한도 검사한다.

## Acceptance Criteria
- [x] 공유 BALANCE가 결정문서 D03/D04의 확률·증가량 표와 정확히 일치한다. D06 골드 보상·성장 값은 T05에서 구현하고 검증한다.
- [x] v1의 고정 강화 확률 상수에 의존하는 테스트가 v2로 전환된다. 적 수 범위와 랜덤 배정은 T05에서 검증한다.
- [x] 결정적 목표 테스트가 모든 D05 접촉 수 및 HP 기준을 통과한다.
- [x] resolveContact와 희귀도/장비 굴림 범위, 경험치·회복 규칙 등 명시적으로 보존된 동작은 회귀하지 않는다.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/game-rules-balance.test.js test/game-rules-simulation.test.js — 밸런스 목표 및 기존 공유 시뮬레이터 테스트가 통과해야 한다.

## Commit Message
~~~text
feat(balance): define v2 combat and enhancement rules

Plan: 2026-10-22-character-gear-balance
Phase: P01-gameplay-and-save
Task: T01-balance-rules-and-calibration

- Add level-banded enhancement probabilities and gains
- Calibrate deterministic combat targets against the balance decision
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: included with this task's implementation and verification.

## Critical Review
- 1차 리뷰의 C1S10 생존 표본이 실제 클리어 없이 통과하는 결함을 수정하고 1,024/1,024 클리어를 강제했다.
- 추가 리뷰에서 연속 seed의 치명타 판정 편향과 adapter의 강화 구간 export 누락을 수정했다. seed 집합 첫 난수값 중 104/1,024가 10% 치명타 구간에 포함되는지 검사한다.
- 최종 리뷰에서 이전 seed 범위 설명과 T01 범위 밖 D06 acceptance를 정정했으며, 잔여 blocker가 없다.
