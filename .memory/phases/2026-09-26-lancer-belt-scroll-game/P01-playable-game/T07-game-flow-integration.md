# Task: T07 저장과 마을/전투 흐름 통합

## Status: in_progress

## Goal

첫 실행, 자동 저장, 새로고침 복구, 마을↔전투 전환, 사망/재시도, 회차 해금이 연결되어 1회차 이후에도 성장 상태를 잃지 않고 플레이하도록 완성한다.

## Decision Summary

- 첫 실행은 마을에서 시작한다. 상태 저장은 localStorage repository를 통한다.
- 새로고침 중 진행 중 전투 위치/적 상태는 저장하지 않는다. 저장된 XP/장비 상태는 유지하고 현재 전투 stage는 처음부터 재시작한다.

## Implementation

### I01. 부팅, 저장 시점, scene payload 연결

- Related Files:
  - `src/main.js` :: `createGame`; modify
  - `src/game/scenes/BootScene.js` :: `create`; modify
  - `src/game/scenes/TownScene.js` :: stage launch/return actions; modify
  - `src/game/scenes/BattleScene.js` :: result transitions; modify
  - `src/game/domain/saveStore.js` :: save/load; read-only
  - `src/game/domain/stateFactory.js` :: `createInitialState`; read-only
- Boot flow: load stored state; if absent or invalid, call `createInitialState()` with level1, xp0, full HP, common equipment, empty inventory, 0 materials, progress 1-1; then start TownScene.
- Scene payload contract:
  ```js
  { gameState, saveState, chapter, stage, isReplay, stageSnapshot }
  ```
  `saveState(nextState)` persists and returns the save result. GameState/snapshot are plain serializable data; saveState is a runtime callback, not part of the saved object. Never pass Phaser objects into the saved state.
- Save after equipment/stat/material/inventory changes, XP/level-up, stage clear/unlock, death resolution, and town return. Also save the selected active stage ID before entering combat. Do not save player x or runtime enemy health/positions.
- Town `전투 출발` starts BattleScene with a structured clone of state as `stageSnapshot`. On clear, save progression and show the choice modal; `마을로` starts TownScene; `다음 스테이지` starts BattleScene with the new unlocked stage. On stage10 of each chapter, next choice points to next chapter stage1.
- On browser reload during battle, BootScene starts TownScene from latest save. Keep unlocked stage and retained state, select the saved active stage in TownScene, and require user to start it again from the beginning.
- Save after all event mutations, not per animation frame. Catch storage failures and show a short Korean notice `저장할 수 없습니다` while allowing the session to continue.

### I02. Responsive flow acceptance and runtime error handling

- Related Files:
  - `src/game/scenes/TownScene.js` :: `refresh`, scene transitions; modify
  - `src/game/scenes/BattleScene.js` :: state transitions/cleanup; modify
  - `src/game/config.js` :: registered scenes; modify
  - `src/styles.css` :: landscape/canvas fit; modify
- Ensure transition handlers are one-shot/disabled while a scene transition is in progress. Destroy stale UI containers before redraw. Prevent two contact callbacks for the same enemy in one overlap.
- Ensure reload or malformed localStorage returns to a valid town state and never displays a blank canvas. Preserve chapter/stage unlock and all retained gear/XP.
- Manually exercise full loop: new save → town → battle → pickup/equip → town → replay → partial XP → death/retry → clear stage 1 → stage 2 → stage 5 boss → stage 10 boss → unlock next chapter → reload.

## Acceptance Criteria
- [ ] Fresh browser storage creates the agreed common starter equipment and opens in town.
- [ ] Reload restores player level/XP/equipment/inventory/materials/unlocks and returns to town.
- [ ] Death retains XP and earned levels, rolls back other in-stage rewards, and retries current stage at full HP.
- [ ] Clear flow allows town or next stage; 10-stage completion unlocks next chapter; completed stages remain replayable.
- [ ] Production build completes and landscape keyboard/touch play works without console errors.

## Validation
- `npm run build` — final production bundle succeeds.
- `npm run dev` manual browser check — perform the full loop in I02 on desktop and a touch-capable landscape viewport; reload once in town and once during a battle.

## Revalidation (2026-10-20)
- Source review and inline Node assertions confirmed the fresh-state factory, boot-to-town wiring, save projection, retry snapshot rollback/XP retention, and stage-10 unlock logic. Production build passed on Node `v20.19.4`, below the declared `>=22.12.0` engine.
- All five original acceptance items remain unchecked because each includes a fresh-browser or live gameplay result that could not be observed; no browser surface was available. Task stays `in_progress`.
- Implementation commit confirmed: `942f5b1 feat(game): connect save and stage loop`.

## Commit Message
```text
feat(game): connect save and stage loop

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T07-game-flow-integration

- connect town and battle scene transitions
- persist progression and recover safely after reload/death
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: 942f5b1
