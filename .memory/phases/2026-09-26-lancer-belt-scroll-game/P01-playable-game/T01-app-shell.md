# Task: T01 Vite와 Phaser 앱 뼈대

## Status: in_progress

## Goal

현재 게임 코드가 없는 저장소에 Phaser 4 + Vite 개발 환경을 만들어 한국어 시작 화면이 브라우저에서 열리고 production build가 성공하도록 한다.

## Decision Summary

- JavaScript ES modules만 사용한다. TypeScript/React/외부 이미지·오디오 라이브러리는 추가하지 않는다.
- Phaser 4.2.1, Vite 8.3.x, Node.js >=22.12.0을 사용한다. 화면은 1280x720 논리 해상도, 가로 비율 `FIT`/`CENTER_BOTH`다.
- 빈 저장소이므로 아래 경로는 모두 새 파일이다. Git 초기화는 이 Task에서 하지 않는다.

## Implementation

### I01. 패키지와 문서 진입점

- Related Files:
  - `package.json` :: 프로젝트 메타데이터 및 `dev`, `build`, `preview` 명령; new
  - `index.html` :: 게임 캔버스 호스트, 한국어 문서 메타데이터; new
  - `vite.config.js` :: Vite 설정; new
  - `.gitignore` :: `node_modules`, `dist`, `.env*` 제외; new

#### Details
- `package.json`은 이름 `lancer-belt-scroll-game`, `private: true`, `type: module`, `engines.node: >=22.12.0`으로 만든다.
- scripts: `dev: vite --host 0.0.0.0`, `build: vite build`, `preview: vite preview --host 0.0.0.0`.
- dependencies: `phaser: 4.2.1`; devDependencies: `vite: ^8.3.0`.
- `index.html`의 `lang`은 `ko`, title은 `마창기사`, body에는 `#game`, 회전 안내 `#rotate-message`, `/src/main.js` module script를 둔다.
- Vite 설정은 `defineConfig({})` 기본값으로 두고 불필요한 plugin/alias를 추가하지 않는다.

### I02. Phaser 실행 구성과 임시 부팅 장면

- Related Files:
  - `src/main.js` :: `createGame()` — Phaser.Game 생성; new
  - `src/game/config.js` :: `createGameConfig(parent)` — 공유 게임 설정; new
  - `src/game/scenes/BootScene.js` :: `BootScene` — 임시 시작 화면; new

#### Details
- Signatures & Types:
  ```js
  @param parent: string
  @returns import('phaser').Types.Core.GameConfig
  export function createGameConfig(parent)
  export function createGame()
  ```
- `createGameConfig`는 renderer `Phaser.AUTO`, width `1280`, height `720`, parent 전달값, 배경 `#17202b`, scale mode `Phaser.Scale.FIT`, autoCenter `Phaser.Scale.CENTER_BOTH`, scene `[BootScene]`을 반환한다.
- `createGame`은 `document.querySelector('#game')`를 확인하고 없으면 명시적 오류를 던진다. 컨테이너 ID를 전달해 `new Phaser.Game(config)`를 한 번 생성한다.
- `BootScene.create()`는 이미지 대신 도형/텍스트로 중앙에 게임 제목과 `마을 화면 준비 중`을 그린다. 이 임시 텍스트는 T05에서 TownScene으로 교체한다.
- portrait viewport에서는 `#game` 대신 `#rotate-message`를 표시하도록 `src/styles.css`에 메시지 요소를 추가한다. JS는 `matchMedia('(orientation: portrait)')` 변경에 따라 메시지와 캔버스를 보이거나 숨긴다.
- 모든 DOM 접근은 `DOMContentLoaded` 이후 실행한다. 캔버스의 `touch-action`은 `none`; body margin은 0이며 게임은 화면에 맞춘다.

## Acceptance Criteria
- [x] 의존성이 설치되어 있고 `npm run dev`가 Vite 주소를 출력한다.
- [ ] 브라우저에서 제목과 임시 시작 화면이 보인다.
- [x] `npm run build`가 `dist/`를 만든다. (Node 20.19.4에서 실행; 지원 버전 검증은 아님)
- [ ] 가로 화면은 16:9 게임 영역을 표시하고 세로 화면은 회전 안내를 보인다.

## Validation
- `npm run build` — Vite production build가 오류 없이 완료된다.
- `npm run dev` 후 브라우저에서 `/` 열기 — 콘솔 오류 없이 임시 화면이 보인다.

## Revalidation (2026-10-20)
- `node --version`: `v20.19.4`; `package.json` requires `>=22.12.0`.
- `npm run build`: passed and created `dist/index.html`; this is not a supported-engine pass.
- `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`: Vite reported `http://127.0.0.1:4173/`; HTTP GET returned 200.
- Browser rendering/orientation remains unverified: no apps or browser surfaces were available; isolated `iab` and `chrome` creation both reported unavailable. The temporary BootScene is now replaced by the T07 TownScene flow, so its old screen criterion is superseded; final town rendering was not observed.
- Static mismatch to revisit: the portrait CSS shows `#rotate-message` but does not hide `#game`, despite the original requirement to show the rotation prompt instead of the game.
- Implementation commit confirmed: `1870e2a feat(game): bootstrap Phaser and Vite app`.

## Commit Message
```text
feat(game): bootstrap Phaser and Vite app

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T01-app-shell

- add JavaScript Vite project shell
- configure Phaser landscape canvas and boot scene
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: 1870e2a

