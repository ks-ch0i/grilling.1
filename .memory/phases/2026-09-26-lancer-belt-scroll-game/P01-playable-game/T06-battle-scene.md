# Task: T06 횡스크롤 전투 장면

## Status: in_progress

## Goal

마을에서 고른 스테이지를 플레이할 수 있도록 좌우 이동, 카메라 추적, 접촉 전투, 장비 자동 획득, 보스, 레벨업 선택, 게임 오버와 스테이지 완료 표시를 구현한다.

## Decision Summary

- 전투 world는 1차원 수평 이동으로 표현한다. 모든 캐릭터/장비는 Phaser geometric shapes다.
- 피해는 T04 도메인 함수를 사용하고, UI 장면은 임의로 계산하지 않는다. player만 knockback되고 접촉 후 무적 시간은 없다.

## Implementation

### I01. 전투 월드와 기사/적 도형

- Related Files:
  - `src/game/scenes/BattleScene.js` :: `BattleScene`, `init`, `create`, `update`, `createPlayer`, `createEnemy`, `spawnStage`; new
  - `src/game/ui/components.js` :: `createButton`; read-only
- Signatures:
  ```js
  init(data: { gameState: GameState, chapter: number, stage: number, isReplay: boolean, stageSnapshot: GameState })
  create(): void
  update(time: number, delta: number): void
  ```
- `worldWidth = 11200`, floor baseline `y=560`, world bounds x=0..11200. Start player at x=120. Place 10 stationary normal enemies at `x = 700 + index*950` (index 0..9). Boss spawns after all 10 are defeated at x=10500 on stages divisible by 5. This stable spacing is the first implementation default for “scattered”.
- Draw floor/background with rectangles. Player is a side-view mounted knight composed of horse body, armor body, helmet, gloves, boots, and spear shapes; read current equipped slot/rarity to tint or alter each piece so gear changes are visible. Normal enemy uses one simple silhouette; boss uses a larger silhouette.
- Camera uses horizontal follow with bounds `[0,0,worldWidth,720]`; set deadzone centered around the middle 45% width. Camera must not scroll beyond either edge.
- Player body is fixed to baseline y; only x changes. Use A/D key state and pointer-held half-screen touch state. Normalize `delta` to seconds; move at `baseStats.moveSpeed * (1+horse.moveSpeedPercent)` world-pixels/sec. Clamp x to world bounds.

### I02. Contact, health HUD, drops, and encounter states

- Related Files:
  - `src/game/scenes/BattleScene.js` :: `handleContacts`, `applyKnockback`, `dropGear`, `updateHud`, `showLevelUp`, `showGameOver`, `showStageClear`; modify
  - `src/game/domain/combat.js` :: `resolveContact`; read-only
  - `src/game/domain/gear.js` :: `rollGear`, `tryStoreDrop`; read-only
  - `src/game/domain/progression.js` :: XP/stage helpers; read-only
- At each update, compare player/enemy AABBs. Keep a `Set<enemyId>` of current contact pairs. Call `resolveContact` only on transition from separated to overlapping; remove ID after separation. This prevents per-frame hits but does not add an invulnerability window.
- Apply enemy HP result first. If enemy dies, suppress player damage as specified. Otherwise update player HP. Push player 96 px away from enemy, clamp world boundary. Do not push enemy.
- Player HUD: chapter-stage, player HP bar/current/max, level and XP, enemy count, selected stage replay marker. Enemy health bar appears above each active enemy; boss bar is wider. Show crit flash using color/tint only, no audio.
- On enemy death award 10 XP (or 30% on replay), roll normal gear drop at 20%, and create a floor item shape with rarity color. On boss death award additional 200 XP and create exactly one gear drop. Touching a floor item calls `tryStoreDrop`; if full, leave it on floor.
- Pause movement when XP crosses a level threshold. Show modal with `공격력 +2`, `방어력 +5`, `최대 HP +10`; after valid selection resume.
- When all enemies/boss are defeated, apply stage-clear 100 XP (or 30% replay), apply half-HP floor rule, advance unlocks, save the clear result, then show choices `마을로` and `다음 스테이지`. On stage10 of each chapter, next choice points to next chapter stage1.
- If player HP reaches zero, freeze combat and show `다시 시작`; call `retryStage(stageSnapshot,currentState)`, retain XP/levels/stat picks, revert items/materials/drops, restore full HP, restart same stage.
- Portrait rotation message from T01 stays visible; battle input only active in landscape.

## Acceptance Criteria
- [ ] Player moves left/right with A/D and held touch halves; camera follows without leaving world bounds.
- [ ] Contact damage occurs once per contact, uses critical and recoil rules, pushes only player, and has no invulnerability timer.
- [x] Ten enemies spawn; stage 5/10 bosses appear after them and use specified multipliers.
- [ ] Drops are visible and collectible; full inventory leaves them on ground.
- [ ] Level-up choice pauses combat; stage clear and game over show correct actions and state.

## Validation
- `npm run build` — BattleScene compiles.
- `npm run dev` manual browser check — play 1-1; walk into and away from enemies; check both collision directions, crit, loot pickup, level-up pause, stage clear, stage 5 boss, death/retry, and touch controls in landscape.

## Revalidation (2026-10-20)
- Source review confirmed ten normal-enemy placements, boss spawn after the tenth, camera/world bounds, held A/D/touch input paths, one-hit-per-contact tracking, player-only knockback, full-inventory floor retention, level-up pause, and clear/death actions. Inline assertions confirmed the stage-1 boss multipliers; build passed on Node `v20.19.4` only.
- The contact criterion remains unchecked because the lethal-strike retaliation defect recorded in T04 is present. Movement, visual loot, level-up, stage-clear, stage-5/10 boss, death/retry, and landscape-touch runtime scenarios remain unverified without a browser; task stays `in_progress`.
- Implementation commit confirmed: `2d1c0c0 feat(game): add belt-scroll battle scene`.

## Commit Message
```text
feat(game): add belt-scroll battle scene

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T06-battle-scene

- add camera-following one-dimensional combat
- add enemies, boss, loot, progression HUD, and touch movement
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: 2d1c0c0

