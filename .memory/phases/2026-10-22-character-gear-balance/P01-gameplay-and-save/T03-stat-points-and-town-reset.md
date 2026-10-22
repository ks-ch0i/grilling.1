# Task: T03 자유 능력치 배정과 마을 초기화

## Status: pending

## Goal
레벨업마다 자유 포인트 두 점을 지급하고, 전투 레벨업 창과 마을에서 배정할 수 있게 한다. 마을에서 골드를 내고 능력치 포인트를 초기화할 수 있게 한다.

## Decision Summary
- 1점은 공격 +5, 방어 +10, 최대 HP +30이다. 레벨업 시 0~2점까지 같은 능력치에 배정하고 나머지는 보유할 수 있다.
- 초기화는 마을에서만 노출한다. 횟수 n의 비용은 ceil(1000 × 1.5^n) 골드다. 성공한 초기화만 비용과 횟수를 증가시킨다.
- 기존 레벨업 시 최대 HP 증가가 현재 HP도 같은 양만큼 올리는 동작을 유지한다. 마을 배정에서 최대 HP를 올릴 때도 현재 HP를 같은 양만큼 올리며, 초기화로 최대 HP가 낮아지면 현재 HP를 새 최대값으로 clamp한다.

## Implementation

### I01. 레벨업과 능력치 domain
- Related Files:
  - src/game/domain/progression.js :: chooseLevelUpStat, grantXp — 배열 배정 기반 resolveLevelUp; modify.
  - src/game/domain/gear.js :: derivePlayerStats — v2 baseStats와 추가 포인트 반영 검증; read-only unless shared helper required.
  - src/game/domain/models.js :: PlayerState — counters; T02 output; read-only.

#### Details
- Signatures & Types:
  ~~~js
  resolveLevelUp(state: GameStateV2, allocations: StatKey[]): {ok:boolean, state?:GameStateV2, reason?:string}
  allocateStatPoint(state: GameStateV2, statKey: 'attack'|'defense'|'maxHp'): Result
  getStatResetCost(resetCount: number): number
  resetStatPoints(state: GameStateV2): {ok:boolean, state?:GameStateV2, cost?:number, reason?:string}
  ~~~
- Execution Flow / Logic:
  1. resolveLevelUp은 pendingLevelUps >= 1, allocations 배열 길이 0–2, 각 키가 attack/defense/maxHp인지 검사한다. 무효 입력은 {ok:false,reason:'invalid-allocation'} 또는 기존 도메인 오류 분류와 일관된 사유를 반환하며 상태를 바꾸지 않는다.
  2. 레벨업 확인 시 level을 1 올리고 pendingLevelUps를 1 줄인다. availableStatPoints에 2 - allocations.length를 더하고 spentStatPoints에 allocations.length를 더한다. 배열의 중복 키는 각 1점으로 적용한다.
  3. 각 포인트는 T01 BALANCE.levelUp 값을 적용한다. maxHp 포인트는 currentHp도 같은 증가량만큼 올리되 새 최대 HP를 넘지 않는다. XP, xpToNext 계산은 기존 xpRequiredForLevel 규칙을 유지한다.
  4. allocateStatPoint는 availableStatPoints가 1 이상일 때만 1점 소모/1점 사용 처리한다. 선택한 stat만 증가시키며 maxHp 선택은 현재 HP도 같은 양만큼 올린다.
  5. getStatResetCost는 안전한 정수 resetCount >=0만 받는다. 반환값은 Math.ceil(1000 * 1.5 ** resetCount)이며 안전한 정수 범위를 넘으면 RangeError를 던진다.
  6. resetStatPoints는 spentStatPoints > 0과 gold >= cost를 요구한다. 성공 시 baseStats를 BALANCE.basePlayer로 초기화하고 spentStatPoints=0, availableStatPoints += 이전 spentStatPoints, statResetCount += 1, gold -= cost로 만든다. 레벨/XP/pending/장비/재료/진행도는 보존한다. currentHp는 새 장비 기준 maxHp 이하로 clamp한다.

### I02. 전투 레벨업 로그와 결정적 재생
- Related Files:
  - packages/game-rules/src/simulation.js :: assertCombatSnapshot, applyLevelUp, validateTickInputs, validateInputLog, stepRankedRun, replayRankedRun — levelUp value array; modify.
  - src/game/scenes/BattleScene.js :: showLevelUp, ranked input recording — allow 0–2 allocation events; modify.
  - test/game-rules-simulation.test.js :: level-up event replay cases; modify.

#### Details
- Data & Schema Fields:
  - ranked combat snapshot은 availableStatPoints와 spentStatPoints를 0 이상의 정수로 포함한다.
  - input event는 {tick:number,kind:'levelUp',value:Array<'attack'|'defense'|'maxHp'>}다. value는 0–2개며 중복 키를 허용한다.
- Execution Flow / Logic:
  1. snapshot validation은 새 포인트 필드를 검증한다. 불완전한 progression snapshot은 기존처럼 거부한다.
  2. 시뮬레이터의 level-up 이벤트는 pendingLevelUps를 하나 줄이고 level을 하나 올린 뒤 2 - 배열 길이만큼 미사용 포인트를 더한다. 각 배열 항목은 해당 능력치 하나를 올린다.
  3. 입력 로그 검증과 tick 검증이 같은 배열 범위를 적용한다. 공격/방어/HP 이외 키, 길이 3 이상, 배열이 아닌 값은 invalid-level-up-allocation으로 거부한다.
  4. 랭킹 재생은 각 pending level-up에 대해 입력 event 하나를 요구한다. 빈 배열은 점수 배정 없이 레벨업을 확정하는 유효 입력이다.

### I03. TownScene 배정/초기화 UI
- Related Files:
  - src/game/scenes/TownScene.js :: renderTown, refresh, stat allocation/reset handlers — v2 stats and gold controls; modify.
  - src/game/scenes/BattleScene.js :: showLevelUp — 2점 선택/보류 표시; T03 I02와 함께 modify.
  - test/stat-points.test.js :: domain allocation/reset tests; new.
  - test/town-stat-ui.test.js :: rendered cost, buttons, disabled states; new if scene harness exists, otherwise extend current TownScene UI tests.

#### Details
- TownScene에 공격/방어/최대HP의 현재 값, 사용할 수 있는 포인트, 각 포인트 상승량, 골드를 표시한다. + 버튼은 포인트 1개와 gold 이외 상태를 바꾸지 않는다.
- 초기화 컨트롤에는 현재 비용과 초기화 후 남는 골드를 표시한다. 포인트 미사용, 점수 부족, 골드 부족일 때 버튼 비활성화 및 기존 메시지 스타일로 이유를 안내한다.
- 레벨업 모달은 새로 얻은 2점을 0, 1, 2개 선택 가능하게 하고 같은 stat 두 번 선택을 지원한다. 확인/보류를 확정하면 결정적 입력 로그에 선택 배열을 기록한다.
- 어느 화면도 임의의 레벨/XP/장비 상태를 초기화하지 않는다.

## Acceptance Criteria
- [ ] 도메인 함수가 중복 배정, 보류, 포인트 부족, 비용 부족, 첫 비용 및 연속 초기화 비용을 정확히 처리한다.
- [ ] 마을 초기화는 레벨/XP/장비를 보존하고 배정 점수를 환급한다.
- [ ] 온라인/오프라인 랭킹 재생에서 빈 배열 또는 최대 2개 선택이 동일한 player state를 만든다.
- [ ] TownScene과 레벨업 창에서 잔여 포인트와 비용을 사용자가 이해할 수 있게 표시한다.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/stat-points.test.js test/game-rules-simulation.test.js — 포인트 계산, 비용 증가, 입력 로그 replay가 통과해야 한다.
- npm run build — Phaser scene import 및 UI bundle이 통과해야 한다.

## Commit Message
~~~text
feat(stats): add free point allocation and respec

Plan: 2026-10-22-character-gear-balance
Phase: P01-gameplay-and-save
Task: T03-stat-points-and-town-reset

- Grant and allocate two stat points per level
- Add gold-priced town reset and versioned replay inputs
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
