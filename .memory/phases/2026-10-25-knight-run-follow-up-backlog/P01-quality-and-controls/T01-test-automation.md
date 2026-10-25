# Task: T01 루트 테스트 자동화

## Status: done

## Goal
루트 test/의 게임·브라우저 도메인 테스트를 npm test로 실행하고, push와 pull request에서 테스트·빌드·API 회귀 검증을 자동 수행한다. 이 검증 workflow는 Azure 인증이나 배포를 수행하지 않는다.

## Decision Summary
- 루트 테스트는 Node 내장 node:test로 실행하고 새 테스트 프레임워크를 추가하지 않는다.
- GitHub Actions는 Node 22.12.0 이상에서 루트와 api/ 테스트 및 프런트엔드 빌드를 실행한다.

## Implementation

### I01. 루트 npm 테스트 명령

- Related Files:
  - package.json :: scripts — 테스트 명령 등록; modify
  - test/**/*.test.js — 기존 Node 테스트; read-only

#### Details
- Signatures & Types:
  - Add script: "test": "node --test \"test/**/*.test.js\"".
- Execution Flow / Logic:
  1. 루트 package.json에 test 스크립트를 추가한다.
  2. node --test의 기본 파일 검색으로 루트 test/ 아래의 *.test.js를 실행한다.
  3. 의존성은 추가하지 않고 lockfile을 변경하지 않는다.

### I02. 배포 없는 검증 workflow

- Related Files:
  - .github/workflows/validate-game.yml :: validate job — push/PR 검증 전용 workflow; new
  - .github/workflows/deploy-game.yml :: 기존 수동 배포 흐름 — 검증/배포 범위 확인; read-only

#### Details
- Workflow contract:
  - Triggers: 모든 branch의 push, pull_request.
  - Permissions: contents: read만 허용한다.
  - Runner: ubuntu-latest.
  - Node: 22.12.0; npm cache 입력은 package-lock.json 및 api/package-lock.json.
  - Steps 순서: checkout v4 → setup-node v4 → root npm ci → npm test → npm run build → npm ci --prefix api → npm --prefix api test.
  - Azure 로그인, 환경 secrets, Static Web Apps·Functions 배포 action은 포함하지 않는다.
- Execution Flow / Logic:
  1. root 설치가 실패하면 이후 단계를 실행하지 않는다.
  2. root 테스트, Vite production build, API 테스트 중 하나라도 실패하면 job을 실패시킨다.
  3. 현재 수동 배포 workflow는 변경하지 않는다. 검증 workflow와 배포 workflow가 독립적으로 동작해야 한다.

## Acceptance Criteria
- [x] npm test가 루트 테스트를 발견하고 실행한다.
- [x] push와 pull request에서 검증 workflow가 실행된다.
- [x] workflow에 Azure credentials, deployment step, deployment token이 없다.
- [x] root test, frontend build, API tests가 모두 성공해야 workflow가 통과한다.

## Validation
- npm test — 기존 루트 테스트 전체 통과.
- npm run build — Vite production build 성공.
- npm ci --prefix api; npm --prefix api test — API 의존성 설치 및 전체 API 테스트 통과.
- GitHub Actions workflow 문법 확인 — validate-game.yml이 push/PR에서 검증만 실행.

## Commit Message
~~~text
ci(test): run game and API checks on pushes and pull requests

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P01-quality-and-controls
Task: T01-test-automation

- Add the root node:test script
- Add a non-deploying GitHub Actions validation workflow
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: 6c0ca26
