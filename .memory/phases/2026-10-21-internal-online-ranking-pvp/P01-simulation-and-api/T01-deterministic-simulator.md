# Task: T01 결정적 전투 시뮬레이터

## Status: done

## Goal
같은 시작 스탯, 버전, 시드, 60Hz 입력 기록을 받으면 브라우저와 Node.js가 동일한 스테이지 전투 결과와 완료 tick을 계산하는 순수 JavaScript 모듈을 만든다.

## Decision Summary
- Stage/PvP 서버 재생의 단일 규칙 소스는 npm workspace 패키지 packages/game-rules다.
- Phaser 객체, DOM, wall clock, Math.random()에 의존하지 않는다. 이동은 수평 방향 -1/0/1, 적은 고정 위치, 충돌 접촉 시 양쪽 피해, 이탈 후 재접촉 시 새 타격이다.
- 규칙 버전은 simulatorVersion 1, balanceVersion은 명시적 정수다. 기존 저장 보상은 서버가 지급하지 않는다.

## Implementation

### I01. 공유 게임 규칙 workspace
- Related Files:
  - package.json :: workspaces — root workspace에 packages/game-rules를 등록; modify.
  - packages/game-rules/package.json :: package metadata — ESM 패키지 @knight-run/game-rules, Node >=22.12; new.
  - packages/game-rules/src/balance.js :: BALANCE, GEAR_SLOT, RARITY, getStageEnemyStats — 기존 밸런스 값과 스테이지 적 수식의 canonical source; new.
  - packages/game-rules/src/combat.js :: applyGearEffects, rollCritical, resolveContact — 현재 domain combat 계산을 순수 모듈로 이동; new.
  - src/game/data/balance.js :: public exports — 기존 import 경로 보존용 re-export; modify.
  - src/game/domain/combat.js :: public exports — 기존 import 경로 보존용 re-export; modify.
  - src/game/domain/progression.js :: getStageEnemyStats — 공유 함수를 재사용하고 나머지 로컬 보상 API 유지; modify.
- Details:
  - package export는 ./balance, ./combat, ./simulation 세 경로로 제한한다.
  - 기존 BALANCE 값, 장비 슬롯 상수, 치명타 상한, 반올림 규칙, 보스 수식을 복사 변경하지 않고 동일 값으로 옮긴다.
  - 기존 frontend import 경로는 re-export로 호환시켜 이 Task만 적용해도 TownScene과 BattleScene이 빌드된다.

### I02. RNG와 입력·결과 계약
- Related Files:
  - packages/game-rules/src/seededRandom.js :: createSeededRandom — 32-bit xorshift RNG; new.
  - packages/game-rules/src/simulation.js :: createRankedRun, stepRankedRun, replayRankedRun — deterministic API; new.
- Details:
  - Signature: createSeededRandom(seed: number): () => number. seed는 1..4294967295의 정수이며 0은 거부한다.
  - Signature: createRankedRun(ticket: RunTicket, player: PlayerCombatSnapshot): RunState.
  - Signature: stepRankedRun(state: RunState, input: RunInputForTick): { state: RunState; events: SimulationEvent[] }.
  - Signature: replayRankedRun(ticket: RunTicket, player: PlayerCombatSnapshot, inputs: RunInputEvent[]): ReplayResult.
  - Signature: replayPvpRun(ticket: PvpRunTicket, player: PlayerCombatSnapshot, opponent: PlayerCombatSnapshot, inputs: RunInputEvent[]): PvpReplayResult. The opponent is a fixed-position contact target; player controls only their own direction.
  - RunTicket: { runId: string; seed: number; chapter: number; stage: number; simulatorVersion: 1; balanceVersion: number; issuedAtUtc: string }.
  - PlayerCombatSnapshot: { maxHp: number; currentHp: number; attack: number; defense: number; critChance: number; critMultiplier: number; moveSpeed: number; effects: Array<{ id: string; value: number }>; level: number; xp: number; xpToNext: number; pendingLevelUps: number; replayXpMultiplier: number }.
  - RunInputEvent: { tick: number; kind: 'move' | 'levelUp'; value: -1 | 0 | 1 | 'attack' | 'defense' | 'maxHp' }.
  - events는 0 이상 정수 tick 오름차순이다. 같은 tick의 move는 최대 하나, levelUp은 유효한 pending level-up이 있을 때만 받는다. 방향은 다음 move 이벤트까지 유지한다.
  - ReplayResult: { valid: boolean; outcome: 'clear' | 'death' | 'incomplete' | 'invalid'; elapsedTicks: number; playerHp: number; rejectReason: string | null }.
  - PvpRunTicket: { matchId: string; seed: number; simulatorVersion: 1; issuedAtUtc: string; timeLimitMs: 60000 }.
  - PvpReplayResult: { valid: boolean; outcome: 'win' | 'loss' | 'draw' | 'invalid'; elapsedTicks: number; playerHp: number; opponentHp: number; playerHpPercent: number; rejectReason: string | null }.
  - 매 tick의 이동은 moveSpeed/60, 기존 world clamp, 기존 적 배치와 충돌 폭, knockbackPixels를 사용한다. tick 중단 없이 접촉·치명타를 정해진 순서로 처리한다.
  - Stage ticket의 저장 스냅샷에는 전투 스탯과 함께 시작 레벨·XP·다음 XP 임계값·pending level-up·반복 도전 XP 배율을 고정한다. 적 처치와 레벨업 입력 재생이 기존 계정 저장의 XP 계산과 일치하도록 한다. 이전 snapshot 호출은 기본 level 1, XP 0, XP 임계값 100, 반복 배율 1을 사용한다.
  - RNG는 전투 치명타에만 적용한다. 랜덤 장비 드롭과 인벤토리 저장은 보상 데이터이며 랭킹 시뮬레이션 결과에 영향을 주지 않는다.
  - PvP는 60,000ms 제한 안에서 플레이어와 고정 상대의 접촉 damage exchange를 계산한다. timeout 종료는 양쪽 HP/maxHP 비율을 반환하고, 동률은 draw다.
  - 서버는 결과에 포함된 승리 여부나 시간을 신뢰하지 않고 RunInputEvent만 재생한다.

### I03. 시뮬레이터 검증
- Related Files:
  - test/game-rules-simulation.test.js :: deterministic cases — seeded replay와 경계값 검증; new.
- Details:
  - 같은 입력을 두 번 재생하면 outcome, elapsedTicks, playerHp가 완전히 같다.
  - seed만 바꿨을 때 치명타 순서가 달라질 수 있지만 같은 seed에서는 고정된다.
  - 잘못된 seed, 역순 tick, 잘못된 stat 선택, 미완료 레벨업 선택, 적 사망 전 조기 clear 제출을 거부한다.
  - 고정 적 위치, 접촉 1회 피해, knockback, 이탈 후 재접촉, 보스 출현 tick, 사망과 clear 경계를 각각 검증한다.
  - PvP 고정 상대, 60초 제한, remaining HP percentage, 정확한 동률을 golden fixture로 검증한다.
  - npm workspace 연결 뒤 현재 게임 Vite build가 기존 import 경로로 통과한다.

## Acceptance Criteria
- [ ] browser와 Node가 golden input fixture에서 같은 hash 가능한 ReplayResult를 낸다.
- [ ] Math.random, Phaser, window, Date.now 없이 같은 입력을 재생할 수 있다.
- [ ] 기존 게임의 balance/combat/progression public import가 유지된다.
- [ ] 이전 저장 schemaVersion 1과 보상 계산은 변경되지 않는다.

## Validation
    node --test test/game-rules-simulation.test.js
    npm run build

## Commit Message
    feat(game-rules): add deterministic ranked battle simulator

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P01-simulation-and-api
    Task: T01-deterministic-simulator

    - Share versioned combat rules between browser and server
    - Replay fixed-tick inputs with seeded combat randomness

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: e572cfe
