# Task: T08 전투 기사 애니메이션 이미지

## Status: done

## Goal
일반·랭킹 스테이지 BattleScene의 도형 기사 렌더링을 생성된 애니메이션 이미지로 대체한다. 이동과 접촉 상태를 시각적으로 구분하면서 전투 시뮬레이터의 입력·피해·랭킹 재생 결과는 그대로 유지한다.

## Decision Summary
- 새 에셋은 기사 1명만 대상으로 하고 일반 적·보스 및 PvP Scene은 기존 도형을 유지한다.
- 투명 PNG, 4열×5행, frame 128×160, 동작 행 순서 idle/run/contact/hit/defeat를 사용한다. 이미지 생성은 imagegen skill을 이용한다.

## Implementation

### I01. 기사 이미지 생성과 asset preload

- Related Files:
  - public/assets/knight/knight-actions.png :: 생성된 20-frame 기사 스프라이트 시트; new
  - src/game/scenes/BootScene.js :: preload — 이미지 로드; modify
  - .memory/decisions/2026-10-25-knight-run-follow-up-work.md :: D04 — 선택된 이미지 범위; read-only

#### Details
- **Asset specification**:
  - Sheet: 512×800 PNG, alpha background, 4 columns×5 rows; each cell exactly 128×160.
  - Character: 마창을 든 기마 기사, side view, facing right, 기존 UI의 dark steel/navy와 muted gold 색감, 여백 없는 고정 발굽 baseline.
  - No background, no text, no border, no enemy, no extra character. 모든 프레임에서 말·기사·창의 비율과 위치를 유지한다.
  - Row order: idle 4 frames, run 4 frames, contact attack 4 frames, hit/knockback 4 frames, defeat 4 frames.
- **Execution Flow / Logic**:
  1. imagegen으로 시트 초안을 만들고 각 cell이 정확히 128×160인 투명 4×5 grid인지 확인한다. 잘못된 분할·프레임 사이 인물 이동·잘린 창은 수정한다.
  2. 시트를 public/assets/knight/knight-actions.png로 저장한다.
  3. BootScene.preload에서 texture key knight를 frameWidth 128, frameHeight 160으로 로드한다. asset이 준비되지 않으면 게임 시작 단계에서 명확한 로드 오류를 표시한다.

### I02. Phaser animation manifest와 BattleScene 연결

- Related Files:
  - src/game/ui/knightAnimations.js :: KNIGHT_ANIMATIONS, selectKnightAnimation — 프레임 범위와 우선순위; new
  - src/game/scenes/BattleScene.js :: create, createPlayer, update, handleContacts, applyRankedStep, showGameOver — sprite와 action state; modify
  - src/game/scenes/BootScene.js :: preload — sheet loader; modify
  - test/knight-animation.test.js :: frame manifest와 action priority; new

#### Details
- **Signatures & Types**:
  ~~~javascript
  export const KNIGHT_ANIMATIONS = Object.freeze({
    idle: { start: 0, end: 3, frameRate: 4, repeat: -1 },
    run: { start: 4, end: 7, frameRate: 10, repeat: -1 },
    contact: { start: 8, end: 11, frameRate: 12, repeat: 0 },
    hit: { start: 12, end: 15, frameRate: 10, repeat: 0 },
    defeat: { start: 16, end: 19, frameRate: 8, repeat: 0 }
  })
  export function selectKnightAnimation({ moving, action })
  ~~~
- **Data & Schema Fields**:
  - Action priority: defeat > hit > contact > run > idle.
  - action is null|'contact'|'hit'|'defeat'; moving is boolean.
- **Execution Flow / Logic**:
  1. BattleScene.create registers each animation once, checking this.anims.exists before create.
  2. createPlayer creates one sprite with texture knight, origin (0.5, 1), display size 128×160, y=FLOOR_Y, depth 10. Replace only player body/horse/armor geometry; retain collision width PLAYER_WIDTH=64 and all player stats.
  3. Set sprite x from player.x. While moving, play run; while stopped, play idle. Keep last nonzero movement direction and set flipX for left travel; idle keeps last facing.
  4. On contact, play contact animation. If the same contact also deals player damage, queue hit after contact completes. Critical alpha feedback remains supported on the Sprite object.
  5. On nonlethal damage, play hit and return to run/idle when complete. On lethal damage, pause game simulation, play defeat once, then show GameOver; visual delay must not write state or alter ranked input ticks.
  6. The normal and ranked scene use the same sprite state mapping. Determine ranked visual events from applyRankedStep’s returned events/new player HP; do not feed animation state back into stepRankedRun.
  7. Equipment remains fully represented by rarity, stats and effects in TownScene. The pilot has one fixed combat sprite and does not add gear-specific image variants. Do not alter enemy or boss geometry.

### I03. Determinism and visual regression checks

- Related Files:
  - test/knight-animation.test.js :: row index ranges, animation priority, direction-facing persistence; new
  - test/game-rules-simulation.test.js :: authoritative simulation regression; read-only
  - src/game/scenes/BattleScene.js :: no simulation mutation from view events; modify

#### Details
- Check all five animation frame ranges are disjoint and cover frames 0–19 exactly.
- Check defeat supersedes hit/contact, hit supersedes contact, and movement selects run/idle only when no action is active.
- Check sprite x/flip updates do not change player.x, contactPairs, combat state, recorder inputs or simulation tick.
- Manually inspect normal battle, ranked battle, lethal contact and retry; enemy and boss remain unchanged shapes.

## Acceptance Criteria
- [x] Article image sheet has exactly 20 aligned frames and transparent background.
- [x] Idle, run, contact attack, hit/knockback, defeat states and return transitions are implemented.
- [x] Normal and ranked BattleScene use the sprite; enemies, bosses and PvpScene remain unchanged.
- [x] Collision bounds, save state, drop logic, combat results and ranked replay inputs are unchanged.
- [x] Missing or malformed texture is shown as a BootScene load error and rejected by BattleScene validation.

## Validation
- `node --test test/knight-animation.test.js test/game-rules-simulation.test.js` — 26 tests passed.
- `npm.cmd test` — 161 tests passed.
- `npm.cmd run build` — Vite production build succeeded and emitted `dist/assets/knight/knight-actions.png`.
- Sprite PNG validation — 512×800, 8-bit RGBA; 20 128×160 frames.
- `git diff --check` passed.
- Browser manual review was not run because this session returned no browser/app surface.

## Commit Message
~~~text
feat(combat): add animated generated knight sprite

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P03-combat-visuals
Task: T08-animated-knight-sprite

- Add a transparent five-action knight sprite sheet
- Keep rendering state separate from deterministic combat simulation
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: `adf9c9d`
- commit: pending
