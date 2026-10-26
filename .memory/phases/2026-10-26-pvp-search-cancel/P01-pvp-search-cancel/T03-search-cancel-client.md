# Task P01-T03: 검색 취소 클라이언트와 전투 시작 확인

## Status: planned

## Goal
클라이언트 생성 SearchId를 검색 요청·취소·상태 재확인에 일관되게 사용한다. 마을 검색 overlay에 취소 동작을 추가하고, 서버가 start를 승인한 뒤에만 PvP simulation을 시작한다.

## Dependencies
- Requires P01-T02 request/response contract.

## Client Contract
- Create a cryptographically random UUID per new search; retain it only in the in-memory search handle and TownScene-to-PvpScene scene data. Do not write it to localStorage, sessionStorage, IndexedDB, CloudSave or URL.
- Expose a search handle with searchId, a completion promise and a cancel method, so TownScene can render the ID-bound cancel action while POST search remains pending.
- POST start sends the same searchId on all retries. Cancel/status retries also reuse it.
- If the search is cancelled before the initial request is sent (for example, during snapshot publish), stop locally and do not create a server search row.
- If cancellation races a pending POST search, keep the overlay open until the server confirms a terminal state. On network error, GET status and/or repeat cancel using the same ID. Never open a second search while outcome is unknown.
- If a matched ticket arrives after local cancel was requested, do not transition to PvpScene; continue cancel/status reconciliation until cancelled, started, or expired is confirmed.
- If the server reports started, reflect the already committed match state and do not send a fresh search ID.

## UI and Scene Behavior
- TownScene.startPvp creates the search handle and adds a cancel button to its overlay. The button changes to a disabled “취소 확인 중...” state while server confirmation is pending.
- Keep the progress text and existing 60 second display. Network retries do not reset the elapsed time or create a new SearchId.
- The overlay remains visible until cancelled/expired/no-opponent is confirmed or a valid matched ticket is handed to PvpScene. Disable town actions that could launch another search during reconciliation.
- Pass both ticket and searchId to PvpScene.
- PvpScene starts an asynchronous activation step during create: call startMatch(searchId, ticket.matchId), wait for server confirmation, then create the run state, views, inputs and timer. Do not simulate, record inputs or submit results before confirmation.
- On start success, proceed with the existing ticket issue-time clock and expiry, then use the existing server-verified result flow. On denied/expired/network-unknown start, show a recovery overlay; retry the same start request or check search status. Do not submit the result unless the match is confirmed started.

## Files and Symbols
- src/api/cloudSaveClient.js — add getPvpSearch(account, searchId), cancelPvpSearch(account, searchId), and startPvpMatch(account, matchId, { searchId }); update searchPvpMatch request body.
- src/game/domain/pvpClient.js — validate API methods; add createMatchSearch/search handle, cancelSearch, getSearchStatus and startMatch; create UUID with crypto.randomUUID and validate state/ticket responses; reuse SearchId on all retries.
- src/game/scenes/TownScene.js — update startPvp, pvp overlay rendering, cancellation pending state, and PvpScene scene data.
- src/game/scenes/PvpScene.js — retain searchId; gate run initialization/input/result on server start confirmation.
- test/api/cloudSaveClient.test.js — verify paths, methods and JSON bodies for status/cancel/start.
- test/pvp/pvpClient.test.js — cover generated UUID, same-ID retries, cancel/status reconciliation, matched ticket handling, no persistent storage, and start idempotency.
- Add a focused scene test only if the existing test harness can instantiate Phaser scenes without a browser; otherwise validate scene integration through root tests and production build.

## Acceptance Criteria
- Each search creates exactly one UUID and every call in that search lifecycle uses it.
- Refresh or browser close does not restore search state; no browser persistence key is introduced.
- Cancel confirmation is required before the TownScene closes the overlay or permits a new search.
- Lost cancel responses do not create a second search or send the matched ticket to PvpScene.
- PvpScene does not advance simulation or accept result input until start confirmation succeeds; preserve the existing 60 second simulation clock and ticket expiry based on IssuedAtUtc.
- Repeated start confirmation with the same search ID/match ID is safe and does not create additional match state.
- Existing snapshot publishing, verified-online eligibility, ticket validation, result submit and history flows remain available.

## Validation Commands
- node --test test/api/cloudSaveClient.test.js test/pvp/pvpClient.test.js
- npm test
- npm run build

## Commit
Plan: 2026-10-26-pvp-search-cancel
Phase: P01-pvp-search-cancel
Task: P01-T03-search-cancel-client
Commit message: feat(pvp): add cancellable matchmaking client flow
