# Task: T03 마을 키보드 탐색

## Status: pending

## Goal
마우스 없이도 TownScene의 주요 선택 항목과 동작 버튼을 키보드로 탐색하고 실행할 수 있게 한다. 포커스 위치를 화면에 표시해 현재 선택을 놓치지 않도록 한다.

## Decision Summary
- 키보드 지원은 TownScene에 한정하며 기존 BattleScene의 A/D 이동 입력은 바꾸지 않는다.
- Tab/Shift+Tab으로 순환, Enter/Space로 실행한다. 비활성 버튼은 포커스 순환에서 제외한다.

## Implementation

### I01. 포커스 컨트롤러

- Related Files:
  - src/game/ui/keyboardNavigation.js :: createKeyboardNavigation — Phaser 키보드 순환 상태와 정리; new
  - test/keyboard-navigation.test.js :: 순환·활성화·정리 검증; new

#### Details
- Signatures & Types:
  ~~~javascript
  export function createKeyboardNavigation(scene)
  // controller: { register(target, { activate, focus, blur, enabled = true }), reset(), destroy() }
  ~~~
- Execution Flow / Logic:
  1. scene.input.keyboard의 keydown handler를 한 번 등록한다.
  2. Tab 또는 ArrowDown/ArrowRight는 다음 target, Shift+Tab 또는 ArrowUp/ArrowLeft는 이전 target으로 이동하고 양 끝에서 순환한다. navigation key는 preventDefault한다.
  3. Enter 또는 Space는 현재 target의 activate를 한 번 실행한다. 반복 keydown은 중복 실행하지 않는다.
  4. 등록된 각 target은 focus와 blur callback으로 테두리 강조를 표시하고 제거한다.
  5. disabled target은 등록하지 않는다. reset은 기존 focus 표시와 참조를 모두 해제한다.
  6. Scene shutdown에서 keydown handler를 제거하고 남은 focus 표시를 정리한다.

### I02. TownScene UI 등록

- Related Files:
  - src/game/ui/components.js :: createButton — 선택적 키보드 controller 등록 hook; modify
  - src/game/scenes/TownScene.js :: create, refresh, renderEquipment, renderInventory, renderSelectedItem, renderStagePanel — TownScene focus targets; modify

#### Details
- Execution Flow / Logic:
  1. TownScene이 create에서 controller를 만들고 Scene shutdown에 해제한다.
  2. refresh 시작 때 controller를 reset하고 화면을 다시 그린다. 제거된 Phaser object를 focus target으로 남기지 않는다.
  3. createButton은 scene.keyboardNavigation이 있을 때만 활성 버튼을 등록한다. 다른 Scene은 현재 동작을 유지한다.
  4. 장착 장비 카드와 현재 표시된 보관함 카드도 키보드 target으로 등록한다. Enter/Space 동작은 pointer selection과 같은 callback을 사용한다.
  5. 능력치 배정·초기화, 장비 장착·분해·강화, 스테이지 이동·출발, PvP 시작 및 이 계획의 PvP 기록 열기 버튼이 모두 순환에 포함된다.
  6. 버튼 포커스는 기존 hover색과 구별되는 3px 밝은 금색 테두리로 표시한다. disabled 버튼은 focus 대상이 아니다.

### I03. 테스트

- Related Files:
  - test/keyboard-navigation.test.js :: 순환 경계, 역방향, 비활성 대상, Enter/Space 중복 실행, reset/destroy cleanup; new
  - src/game/ui/keyboardNavigation.js :: 테스트 대상; new

## Acceptance Criteria
- [ ] TownScene에서 Tab/Shift+Tab 및 화살표 키로 활성 컨트롤과 표시된 아이템을 순환한다.
- [ ] Enter/Space가 pointer action과 같은 결과를 내며 key repeat로 동작이 중복되지 않는다.
- [ ] 포커스 테두리가 보이고 화면 refresh 뒤 오래된 target이 남지 않는다.
- [ ] BattleScene의 A/D 이동과 기존 마우스·터치 조작은 바뀌지 않는다.

## Validation
- node --test test/keyboard-navigation.test.js — 키보드 순환 테스트 통과.
- npm test — 루트 테스트 전체 통과.
- npm run build — Vite production build 성공.
- 브라우저 수동 확인 — TownScene 전 기능을 키보드로 선택·실행하고 BattleScene A/D 이동 확인.

## Commit Message
~~~text
feat(town): add keyboard focus and activation

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P01-quality-and-controls
Task: T03-town-keyboard-navigation

- Add a scene-scoped keyboard focus controller
- Register TownScene buttons and item cards for keyboard use
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
