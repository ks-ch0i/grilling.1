# Task: T02 마을 보관함 터치 스크롤

## Status: pending

## Goal
가로 화면 터치 기기에서 마을 보관함을 세로로 드래그해 탐색할 수 있게 한다. 기존 마우스 휠, 아이템 선택, 보관함의 2열 배치는 유지한다.

## Decision Summary
- 보관함은 2열, 표시 영역은 5행, 행 간격은 78 game pixels로 계산한다.
- 스크롤 상태는 아이템 오프셋이 아니라 정수 행 번호로 관리하며 터치 드래그와 마우스 휠이 같은 상태를 갱신한다.

## Implementation

### I01. 보관함 스크롤 행 계산

- Related Files:
  - src/game/ui/inventoryScroll.js :: getMaxInventoryScrollRow, clampInventoryScrollRow, getDragScrollRow — 순수 스크롤 계산; new
  - test/inventory-scroll.test.js :: 보관함 행 경계·드래그 계산 테스트; new

#### Details
- Signatures & Types:
  ~~~javascript
  export function getMaxInventoryScrollRow(itemCount, columns = 2, visibleRows = 5)
  export function clampInventoryScrollRow(row, itemCount, columns = 2, visibleRows = 5)
  export function getDragScrollRow(startRow, startY, currentY, itemCount, rowHeight = 78, columns = 2, visibleRows = 5)
  ~~~
- Data & Schema Fields:
  - 입력은 음수가 아닌 safe integer itemCount, 정수 row, 양수 정수 columns·visibleRows, 양수 유한수 rowHeight다.
  - 최대 행은 max(0, ceil(itemCount / columns) - visibleRows)다.
- Execution Flow / Logic:
  1. 잘못된 레이아웃 수치나 아이템 수는 RangeError로 거절한다.
  2. 드래그 이동은 round((startY - currentY) / rowHeight) 행으로 변환한다.
  3. 계산된 행은 0부터 최대 행까지 clamp한다.

### I02. TownScene 포인터 드래그 통합

- Related Files:
  - src/game/scenes/TownScene.js :: create, refresh, renderInventory — 휠·드래그 입력 및 표시 행 갱신; modify

#### Details
- Data & Schema Fields:
  - Scene 상태: inventoryScrollRow: number, inventoryDrag: null | { pointerId: number, startY: number, startRow: number, moved: boolean }.
  - 스크롤 viewport: game coordinates x=470..900, y=190..600; 2열, 5행, 78px 행 간격. 카드 높이는 74px로 두어 5개 행이 viewport 안에 들어가게 한다.
- Execution Flow / Logic:
  1. 기존 wheel listener를 유지하고 delta의 부호만큼 행 번호를 갱신한다.
  2. viewport 안에서 pointerdown이 시작되면 pointer id, 시작 y, 현재 행을 기록한다.
  3. 같은 pointer의 이동이 8px를 넘으면 drag로 판정하고 getDragScrollRow로 상태를 갱신한다. 행이 실제로 바뀔 때만 보관함을 다시 그린다.
  4. 아이템 카드 선택은 pointerdown이 아닌 pointerup 시점에 실행하고, drag로 판정된 pointer는 선택 동작을 억제한다.
  5. pointerup, pointerupoutside, Scene shutdown에서 drag 상태와 입력 listener를 정리한다.
  6. 화면 재구성 후에도 현재 행을 유지하되 아이템 수가 줄면 최대 행으로 clamp한다.
  7. 렌더링에서 아이템 행은 floor(index / 2) - inventoryScrollRow로 계산한다. 기존 아이템 정렬과 장착/분해 동작은 바꾸지 않는다.

### I03. 회귀 테스트

- Related Files:
  - test/inventory-scroll.test.js :: 최대 행·경계·드래그 계산; new
  - src/game/scenes/TownScene.js :: pointer listener 수명·아이템 탭 처리; modify

#### Details
- 빈 인벤토리, 10개 이하, 11개 이상, 홀수 아이템 수에서 최대 행을 확인한다.
- 위/아래 드래그, viewport 경계에서의 드래그, 최대 행을 넘는 드래그를 확인한다.
- 짧은 탭은 아이템을 선택하고 임계값 이상 드래그는 아이템 선택을 일으키지 않는다.
- 마우스 휠도 기존처럼 2열 행 단위로 이동한다.

## Acceptance Criteria
- [ ] 모바일 가로 화면에서 보관함을 위·아래로 드래그할 수 있다.
- [ ] 마우스 휠 스크롤과 아이템 선택이 기존처럼 동작한다.
- [ ] 스크롤은 첫 행과 마지막 행을 넘어가지 않는다.
- [ ] 보관함 5개 표시 행이 panel 경계와 하단 stage controls를 침범하지 않는다.
- [ ] Scene 재시작 후 입력 listener가 중복 등록되지 않는다.

## Validation
- node --test test/inventory-scroll.test.js — 스크롤 계산 회귀 테스트 통과.
- npm test — 루트 테스트 전체 통과.
- npm run build — Vite production build 성공.
- 브라우저 수동 확인 — 가로 터치 드래그와 데스크톱 휠에서 같은 아이템 목록 순서 확인.

## Commit Message
~~~text
feat(town): support touch scrolling in the inventory

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P01-quality-and-controls
Task: T02-town-touch-scroll

- Track inventory scroll position by row
- Support touch drag while preserving item taps and wheel input
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
