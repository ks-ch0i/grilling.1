# Task: T06 Entra 로그인과 오프라인 저장

## Status: done

## Goal
MSAL 로그인 뒤 Entra 계정별로 게임 저장을 분리하고 최초 로컬 저장 이전, 오프라인 진행 저장, 재접속 동기화, 클라우드 충돌 복구를 구현한다.

## Decision Summary
- 첫 인증에는 온라인이 필요하지만 로그인된 계정은 일시 오프라인에서 기존 캐시 저장을 쓸 수 있다.
- 계정 클라우드 저장이 있으면 항상 클라우드 우선이다. 충돌한 로컬 JSON은 복구 키에 백업하고 자동 병합하지 않는다.
- 로그인은 사용자가 로그인 버튼을 눌렀을 때 popup으로 진행하고, 토큰은 silent-first이며 interaction-required일 때만 token popup fallback을 한다.

## Implementation

### I01. MSAL bootstrap 및 API token client
- Related Files:
  - package.json, package-lock.json :: @azure/msal-browser — MSAL Browser 5; modify.
  - .env.example :: VITE_ENTRA_TENANT_ID, VITE_ENTRA_SPA_CLIENT_ID, VITE_ENTRA_API_SCOPE, VITE_FUNCTIONS_API_BASE_URL — 설명 값; new.
  - auth-popup.html, vite.config.js :: MSAL v5 redirect bridge page and build entry; new/modify.
  - src/auth/msalClient.js :: initializeAuth, getSignedInAccount, getApiAccessToken, signInInteractively — MSAL 설정; new.
  - src/api/cloudSaveClient.js :: getCurrent, putCurrent — Bearer token and conditional save requests; new.
  - src/main.js :: createGame, startApplication — 인증 bootstrap과 로그인 gate; modify.
  - index.html, src/styles.css :: accessible login, account chooser and connection status; modify.
  - src/game/domain/saveStore.js :: account-key reads/writes; modify.
  - src/game/domain/accountSaveCoordinator.js :: loadAccountSave, saveLocal, syncPendingSave, resolveConflict — local/cloud orchestration; new.
  - test/auth/msalClient.test.js, test/api/cloudSaveClient.test.js, test/save/accountSaveCoordinator.test.js — token, API and offline/conflict cases; new.
- Details:
  - MSAL config authority는 https://login.microsoftonline.com/<tenantId>, cacheLocation은 localStorage다. Popup callback은 전용 /auth-popup.html redirect bridge를 사용하며 Entra SPA redirect URI에 등록해야 한다.
  - initializeAuth()는 PublicClientApplication을 초기화한 뒤 getAllAccounts()에서 tenant가 설정값과 같은 계정을 선택한다. 여러 계정이면 account chooser를 표시한다.
  - getApiAccessToken(account)은 acquireTokenSilent({ account, scopes:[VITE_ENTRA_API_SCOPE] })를 먼저 호출한다. InteractionRequiredAuthError인 경우에만 loginPopup 또는 acquireTokenPopup을 시작한다. 그 외 오류는 자동 popup 반복 없이 명시적 재시도 화면을 보인다.
  - 최초 로그인 전 오프라인은 게임을 시작하지 않고 로그인 필요 상태를 보인다. 이미 계정 식별과 local save가 있으면 네트워크 오류 때만 해당 계정 오프라인 모드로 시작한다.
  - `createGame`은 identity context와 API token provider, 저장 어댑터를 전달한다. 인증 성공 전에는 game instance를 만들지 않는다.
  - client environment 값은 Vite 빌드 공개값이며 비밀을 두지 않는다. API가 token을 반드시 재검증한다.

### I02. 계정별 저장 마이그레이션과 conflict coordinator
- Related Files:
  - src/game/domain/saveStore.js :: SAVE_KEY, loadGameState, saveGameState — account key와 기존 schema 검증; modify.
  - src/game/domain/accountSaveCoordinator.js :: loadAccountSave, saveLocal, syncPendingSave, resolveConflict — local/cloud orchestration; new.
  - src/game/domain/accountSaveCoordinator.js :: LEGACY_OWNER_KEY — legacy unscoped save를 처음 연결한 계정 기록; same new file.
  - src/main.js :: boot save flow — coordinator wiring; modify.
  - test/save/accountSaveCoordinator.test.js :: first login/offline/conflict cases; new.
- Details:
  - Local account key는 lancer-belt-scroll-game:save:v1:TENANT_ID:OBJECT_ID다. 충돌 복구 key는 lancer-belt-scroll-game:recovery:v1:TENANT_ID:OBJECT_ID:UTC_TIMESTAMP다. Legacy owner key는 lancer-belt-scroll-game:save:v1:legacy-owner이며 { tenantId, objectId }를 저장한다.
  - 기존 unscoped SAVE_KEY를 읽을 수 있도록 유지한다. LEGACY_OWNER_KEY가 없고 cloud save가 404이며 legacy save가 valid일 때만 현재 계정이 legacy owner가 되어 PUT If-None-Match:*로 업로드한다. 업로드 성공 뒤 owner key를 기록한다. 원본 legacy key는 복구를 위해 보존한다.
  - LEGACY_OWNER_KEY가 다른 계정이면 legacy save를 현재 계정으로 절대 복사하지 않는다. 해당 계정의 cloud save가 없으면 createInitialState()로 새 account save를 만든다.
  - CloudSave가 있으면 account key를 cloud state로 초기화한다. 현재 계정 소유의 account local 값이나 아직 owner가 없는 legacy 값이 다르면 cloud와 다른 JSON을 recovery key에 복사하고 UI에 복구 가능 안내를 띄운다.
  - 오프라인 save는 localStorage에 즉시 저장하고 pending flag/revision을 같이 기록한다. online event 또는 API health 복구 때 마지막 pending payload를 If-Match revision으로 PUT한다.
  - 409 conflict면 response current cloud save를 적용하고 pending local state를 recovery key에 보관한다. 자동 merge, timestamp 우선, retry overwrite는 금지한다.
  - CloudSave API가 실패해도 기존 saveGameState 결과가 성공이면 플레이는 계속한다. localStorage failure는 기존 save warning 경로를 사용한다.
  - 여러 계정 전환은 새 계정 key를 별도 로딩하고 다른 계정의 pending save를 업로드하지 않는다.

## Acceptance Criteria
- [x] 기존 schemaVersion 1 legacy 저장이 첫 계정에 1회만 연결된다.
- [x] 두 Entra 계정의 저장 키와 server row가 분리된다.
- [x] 오프라인 local write는 게임을 막지 않고 reconnect 시 조건부 저장된다.
- [x] cloud conflict 시 cloud wins, local backup 유지, 자동 덮어쓰기 없음.
- [x] login silent-first와 interaction-required popup fallback이 구분된다.

## Validation
    npx --yes node@22 --test test/auth/msalClient.test.js test/api/cloudSaveClient.test.js test/save/accountSaveCoordinator.test.js
    npx --yes node@22 ./node_modules/vite/bin/vite.js build

Live Entra sign-in was not exercised. Configure the placeholder values in `.env` and register the exact `/auth-popup.html` redirect URI plus the API scope in the Entra SPA registration before an authenticated browser run.

## Commit Message
    feat(auth): add Entra sign in and account scoped saves

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P02-browser-integration
    Task: T06-auth-and-offline-saves

    - Gate game startup behind the single-tenant account flow
    - Sync versioned saves and preserve cloud conflicts locally

## Progress
- [x] 구현 완료
- [x] 검증 통과: 14 auth/API/save tests on Node 22; Vite multi-page production build succeeded.
- commit: 789d35a
