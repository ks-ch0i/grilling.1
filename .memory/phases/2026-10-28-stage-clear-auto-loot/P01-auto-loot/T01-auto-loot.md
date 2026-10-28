# Task: T01 스테이지 클리어 자동 습득

## Status: done

## Goal
클리어에서 남은 모든 드롭을 기존 용량 한도 안에서 습득하고 랭킹 결과 재현과 일치시킨다.

## Decision Summary
- 로컬 클리어만 거리 제한을 무시하고 `tryStoreDrop`으로 바닥 드롭을 순서대로 처리한다. 사망 시 변경하지 않는다.
- 신규 랭킹 v5는 clear 결과의 모든 결정적 드롭을 수집하고, 발급된 v4는 기존 이동 경로 기준을 보존한다. 신규 발급 v5, 제출 v4/v5 지원. 기존 v3 불허.

## Implementation

### I01. 로컬 장면
- `src/game/scenes/BattleScene.js` :: `finishStage`, `collectDrops` — 수정.
- `collectDrops({ all = false } = {})`에서 all이면 거리만 무시하고 기존 `tryStoreDrop(state, item)`과 저장 및 제거 흐름을 따른다. `finishStage`에서 클리어 직전에 호출한다. 랭킹은 서버 결과로 확정한다.
- 스키마 변경 없음. 포화 보관함은 실패 아이템을 추가하지 않는다.

### I02. 랭킹 재현 및 티켓
- `packages/game-rules/src/simulation.js` :: `assertTicket`, `STAGE_LAYOUTS`, `stageResult`, layout defaults; `packages/game-rules/src/rewards.js` :: `validateDropTicket`, `resolveStageDrops` — 수정.
- v4/v5는 같은 4800px 레이아웃을 사용하며 v4의 수집 규칙을 보존한다. `resolveStageDrops(ticket, defeatedEnemies, playerPath, { autoCollect = false } = {})`는 autoCollect일 때 모든 생성 드롭 ordinal을 반환한다. `stageResult`는 v5 clear에서만 autoCollect를 사용한다. death 및 v4는 거리 기반이다.
- `api/src/repositories/stageRankingRepository.js`, `api/test-support/stageRuns.js` :: preserve supported v4 active tickets until terminal/expiry instead of expiring on new ticket request.
- `api/src/domain/gameVersions.js` :: `SIMULATOR_VERSION` 5, 지원 버전 [4, 5]; 발급 v5, v4 결과 제출 가능. `src/game/domain/rankedRunClient.js` :: v4/v5 티켓 수용.
- `test/game-rules-rewards.test.js`, `test/game-rules-simulation.test.js`, `test/ranked-stage-client.test.js`, `api/test/stageRuns/*` :: 현재 버전 fixtures 수정 및 유효 v4/새 v5 경계 회귀 검증.
- 랭킹 authoritative inventory는 서버의 resolveStageRewards가 순서와 용량을 제한한다. 중복 보상 금지, 실패 또는 사망 시 자동 수집 금지.

## Acceptance Criteria
- [x] 클리어만 남은 드롭을 거리와 무관하게 보관함 용량까지 수집한다.
- [x] v5 clear 전체 수집; death 및 v4는 기존 규칙 유지. 서버 발급과 클라이언트 검증이 정합하다.
- [x] 자동 검증과 빌드 통과; 기존 v4 제출 호환 검증.

## Validation
- `node --test test/game-rules-rewards.test.js test/game-rules-simulation.test.js test/ranked-stage-client.test.js`
- `node --test api/test/stageRuns/startStageRun.test.js api/test/stageRuns/submitStageResult.test.js`
- `npm run build`
- `git diff --check`

## Commit Message
```text
fix(stage): collect remaining drops on clear

Plan: 2026-10-28-stage-clear-auto-loot
Phase: P01-auto-loot
Task: T01-auto-loot
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: see git history
