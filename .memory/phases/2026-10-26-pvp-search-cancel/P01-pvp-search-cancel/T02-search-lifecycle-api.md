# Task P01-T02: 검색 lifecycle 서비스와 인증 API

## Status: planned

## Goal
DB 저장소를 사용해 검색 시작·상태 확인·취소·경기 시작 경계를 구현한다. 같은 SearchId의 HTTP 재시도는 기존 row/ticket을 반환하고 중복 loop를 만들지 않으며, 결과 제출은 서버가 시작을 승인한 매치만 받는다.

## Dependencies
- Requires P01-T01 schema and repository methods.

## API Contract
All routes use the existing Entra-authenticated withUser boundary.

1. POST pvp/matches/search, JSON {searchId}
   - Validate searchId as UUID. First owner request creates searching state and owns one matchmaking loop.
   - New search with ticket: 201 {searchId, state: matched, ticket}.
   - Repeated active search: 202 {searchId, state: searching}; it never starts a second loop.
   - Existing matched or started state: 200 and the same ticket, if it is still within its ticket/search lifetime.
   - Existing cancelled/expired state: 200 {searchId, state}; existing no-opponent state returns 404 {searchId, state: no-opponent, code: no-opponent}.
   - After the 60 second deadline, transition searching to no-opponent and set RetainUntilUtc = transition time + 10 minutes.
2. GET pvp/matches/search/{searchId}
   - Owner receives 200 {searchId, state, matchId?}; state matched or started also includes the same ticket.
   - Unknown, other-owner, or logically expired search returns 404 {code: search-not-found}.
3. POST pvp/matches/search/{searchId}/cancel, empty JSON allowed
   - searching or matched+issued transitions to cancelled and returns 200 {searchId, state: cancelled}.
   - If matched ticket is already expired, record expired and return 200 {searchId, state: expired}.
   - Repeated cancel returns the current terminal state with 200.
   - started returns 409 {searchId, state: started, code: match-already-started}.
   - Unknown/other-owner/logically expired returns 404 {code: search-not-found}.
4. POST pvp/matches/{matchId}/start, JSON {searchId}
   - Owner with linked, unexpired issued ticket transitions match and search to started; preserve the original ExpiresAtUtc and return 200 {searchId, matchId, state: started}.
   - Repeated start is idempotent and returns the same committed state.
   - Cancelled, expired, missing, mismatched or expired ticket returns 404/409/410 with stable codes; never starts locally on failure.
5. POST pvp/matches/{matchId}/result
   - First result is accepted only when match Status is started and received before its original ExpiresAtUtc. Preserve idempotent return of an already completed result.
   - An issued, cancelled/expired, or otherwise non-started match cannot apply rating.

## Service and Transaction Behavior
- Replace direct findOpponent loop in api/src/services/matchmakingService.js with a searchId-aware lifecycle while preserving initial ±100, +100 every 5 seconds to ±500, and maximum 60 seconds.
- Create the search row before searching. Only the request that atomically creates the row runs the loop; duplicates read and return state.
- At each maximum 5 second interval and before issuing a candidate, reread the search state. Stop promptly when cancelled, started, expired, or otherwise terminal.
- For a candidate, use one transaction to create the match and call attachSearchMatch. If candidate/match creation is unavailable, continue the same search loop within its deadline.
- Cancel and start services call their repository transition in one transaction. They use the T01 row-lock order; the first committed transition wins. Keep the existing 10 minute ExpiresAtUtc and the existing simulation clock based on IssuedAtUtc.
- If a caller loses the response after cancel/start, repeat GET status or the same POST with the same IDs; repository transitions are idempotent.
- Add create/get/cancel/start methods to createMatchmakingService for dependency injection and unit testing.
- Do not treat HTTP disconnect as cancellation. Server search ends via explicit cancel state or its 60 second deadline.

## Files and Symbols
- api/src/domain/pvpRating.js — validateSearchRequest accepts exactly one valid searchId; add validators for searchId and start request as needed.
- api/src/services/matchmakingService.js — add search lifecycle methods, single-loop claim behavior, state polling and ticket reuse.
- api/src/services/pvpResultService.js and api/src/repositories/pvpRepository.js — allow first result only from started, while preserving completed-result idempotency; expire overdue issued or started matches at the existing ExpiresAtUtc.
- api/src/functions/pvp.js — inject lifecycle service; add handlers getSearch, cancelSearch, startMatch; keep authentication and bounded JSON parsing.
- api/src/functions/pvpMatches.js — register GET search/{searchId}, POST search/{searchId}/cancel, POST {matchId}/start routes and export handlers.
- api/test/pvp/matchmakingService.test.js — cover unique loop ownership, same-ID retries, cancellation polling at <=5 seconds, 60 second deadline, duplicate ticket return and ticket-create/attach atomicity.
- api/test/pvp/pvpFunctions.test.js — cover auth, route extraction, body validation, status codes and ownership-safe 404.
- api/test/pvp/pvpResultService.test.js — cover result rejection before started and completed-result idempotency.
- api/test-support/pvp.js — represent search state and started matches in in-memory repository fixtures.

## Acceptance Criteria
- Repeated same-ID start requests never launch a second loop and return the existing state or ticket.
- A cancel observed before ticket creation prevents match issue; a cancel after issue expires the ticket atomically and releases the opponent candidate.
- A concurrent start and cancel have exactly one successful committed transition; the loser receives a stable current-state response.
- Search checks cancellation no slower than 5 seconds plus DB/request execution time and ends by the 60 second deadline.
- Status GET and retry POST never expose a ticket belonging to another PlayerId.
- Start confirmation gates simulation and result submission; it does not change the existing ticket issue time, expiry deadline, or 60 second simulation clock.
- Result submission cannot mutate ratings before start confirmation; repeated completed submissions retain current idempotent response.
- Existing snapshot eligibility, rating windows, ticket payload, result verification, history, and ranking behavior remain intact.

## Validation Commands
- node --test api/test/pvp/matchmakingService.test.js api/test/pvp/pvpFunctions.test.js api/test/pvp/pvpResultService.test.js
- npm run check --prefix api

## Commit
Plan: 2026-10-26-pvp-search-cancel
Phase: P01-pvp-search-cancel
Task: P01-T02-search-lifecycle-api
Commit message: feat(pvp): add idempotent search cancel and start APIs
