# Task: T04 Phaser 초기 로딩 지연

## Status: done

## Goal
인증 및 계정 저장 확인이 끝날 때까지 Phaser와 게임 Scene 모듈을 다운로드하지 않도록 초기 import를 비동기화한다. 로그인 화면의 초기 진입 payload에서 게임 런타임을 분리한다.

## Decision Summary
- 로그인·저장 동기화는 현재 순서를 유지하고, 계정 저장이 준비된 뒤 게임 런타임을 import한다.
- 동적 import는 초기 payload만 분리한다. Phaser async chunk 자체가 500 kB를 넘을 수 있으므로 경고 제거를 성공 조건으로 삼지 않는다.

## Implementation

### I01. 비동기 게임 생성

- Related Files:
  - src/main.js :: createGame, startApplication, startForAccount — 동적 import 및 await; modify
  - src/game/config.js :: createGameConfig — 동적으로 읽히는 Phaser 의존 모듈; read-only

#### Details
- Signatures & Types:
  ~~~javascript
  export async function createGame(options)
  // returns Promise<Phaser.Game>
  ~~~
- Execution Flow / Logic:
  1. src/main.js의 top-level Phaser 및 createGameConfig static imports를 제거한다.
  2. createGame 호출 시 const { default: Phaser } = await import('phaser')와 const { createGameConfig } = await import('./game/config.js')를 수행한다. 계정 저장이 준비되기 전에는 Phaser와 Scene graph를 로드하지 않는다.
  3. createGame은 기존 bootstrap fields를 preBoot callback에 그대로 전달하고 destroy 시 ranking client를 dispose한다.
  4. startForAccount는 await createGameInstance(...)를 기다린 다음 ranking connection을 연결하고 auth gate를 숨긴다.
  5. 런타임 import가 실패하면 game reference를 설정하지 않고 기존 retry auth gate에 재시도 가능한 게임 로딩 오류를 표시한다. 반복 시도에서 starting flag는 finally에서 해제한다.

### I02. 비동기 시작 경로 검증

- Related Files:
  - test/application-startup.test.js :: 인증·저장 완료 후 비동기 game factory가 끝나야 게임 gate가 닫히는지 검증; new
  - src/main.js :: startApplication injected createGameInstance; modify

#### Details
- Deferred game factory가 resolve되기 전에는 auth gate가 숨지 않는지 확인한다.
- factory reject 시 재시도 버튼이 표시되고 다음 시도에서 성공할 수 있는지 확인한다.
- factory는 한 계정에서 한 번만 호출되고 ranking connect/dispose 순서는 기존 동작과 같아야 한다.

## Acceptance Criteria
- [x] Vite initial entry module에서 Phaser 및 게임 Scene의 정적 import가 사라진다.
- [x] 로그인과 계정 저장 확인이 성공한 다음 Phaser async chunk가 요청된다.
- [x] 인증, cloud save 충돌·offline 복구, Scene bootstrap 전달이 이전과 동일하다.
- [x] 런타임 import 오류가 재시도 가능한 오류로 표시된다.

## Validation
- node --test test/application-startup.test.js — 지연·거절·재시도 경로 통과.
- node --test test/application-startup.test.js — 지연 시작, 실패후 retry, runtime dynamic import 검증 통과.
- npm test — 루트 테스트 전체 통과.
- 브라우저 network panel 수동 확인은 사용 가능한 브라우저 surface가 없어 실행하지 못했다. production build에서 61.15 kB initial main과 1.37 MB Phaser async chunk가 분리된 것을 확인했다.
- npm run build — initial entry와 async game chunk가 생성되고 production build 성공.

## Commit Message
~~~text
perf(app): defer Phaser loading until account save is ready

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P01-quality-and-controls
Task: T04-defer-game-runtime

- Move Phaser and scene imports behind the authenticated game startup
- Preserve retry behavior when runtime loading fails
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: recorded after task commit
