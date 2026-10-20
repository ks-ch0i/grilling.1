# Task: T01 Vite와 Phaser 앱 뼈대

## Status: done

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
- [x] 격리 브라우저에서 `마창기사` 제목과 현재 TownScene이 보인다. (임시 BootScene 기준은 후속 T07 흐름으로 대체)
- [x] Node.js `>=22.12.0`에서 `npm run build`가 `dist/`를 만든다.
- [x] 가로 화면은 16:9 게임 영역을 표시하고, 미지원 세로 화면에서는 게임 대신 회전 안내를 보인다.

## Validation
- `npm run build` — Vite production build가 오류 없이 완료된다.
- `npm run dev` 후 브라우저에서 `/` 열기 — 콘솔 오류 없이 현재 TownScene이 보인다.
- `npx --yes node@22.12.0 --test test/portrait-orientation.test.js` — 세로 화면의 게임 숨김·회전 안내 표시 규칙을 확인한다.
- 격리 Playwright Chromium에서 1280x720 및 390x844 뷰포트를 확인한다 — 현재 TownScene, 16:9 캔버스, 세로 회전 안내, 브라우저 콘솔 오류를 확인한다.

## Revalidation (2026-10-20)
- `node --version`: `v20.19.4`; `package.json` requires `>=22.12.0`.
- `npm run build`: passed and created `dist/index.html`; this is not a supported-engine pass.
- `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`: Vite reported `http://127.0.0.1:4173/`; HTTP GET returned 200.
- Browser rendering/orientation remains unverified: no apps or browser surfaces were available; isolated `iab` and `chrome` creation both reported unavailable. The temporary BootScene is now replaced by the T07 TownScene flow, so its old screen criterion is superseded; final town rendering was not observed.
- At audit time, portrait CSS showed `#rotate-message` without hiding `#game`; the follow-up below resolves this mismatch.
- Implementation commit confirmed: `1870e2a feat(game): bootstrap Phaser and Vite app`.

### Follow-up Execution (2026-10-20)
- Added `body.is-portrait #game { display: none; }` so the unsupported portrait orientation blocks gameplay and shows only the rotate notice.
- Added `test/portrait-orientation.test.js`; its test failed before the CSS fix and passed after it.
- `npx --yes --package=node@22.12.0 --call "node --version && npm run build"`: Node `v22.12.0`; build passed. Vite reported the existing Phaser bundle-size advisory (>500 kB).
- Isolated Playwright Chromium verified the TownScene and `마창기사` title at 1280x720, 16:9 canvas sizing, and a 390x844 portrait viewport with the canvas hidden and `가로 화면으로 돌려 주세요.` displayed. No browser console or page errors occurred.
- Used a fresh temporary browser profile; existing save data was not accessed or changed.

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
- [x] 검증 통과
- commit: 1870e2a

