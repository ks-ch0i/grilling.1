# Task P01-T01: PvP 검색 상태 schema와 repository 경계

## Status: done

## Goal
검색 UUID를 소유자와 상태에 연결하는 영속 테이블을 추가하고, match 티켓 발급·취소·시작이 같은 DB transaction에서 원자적으로 경합할 수 있는 repository 계약을 만든다.

## Scope
- Add migration api/migrations/008-pvp-search-state.sql.
- Update api/src/repositories/pvpRepository.js and test fixtures to expose search and match transition primitives.
- Update api/test/database/schema-contract.test.js and api/test/pvp/pvpRepository.test.js.
- No handler/service/UI implementation in this task.

## Schema
Create dbo.PvpMatchSearches:
- SearchId uniqueidentifier NOT NULL PRIMARY KEY. This is the client-generated idempotency key.
- PlayerId uniqueidentifier NOT NULL FK to dbo.Players(PlayerId).
- Status nvarchar(16) NOT NULL CHECK IN (searching, matched, started, cancelled, no-opponent, expired).
- MatchId uniqueidentifier NULL FK to dbo.PvpMatches(MatchId).
- CreatedAtUtc datetime2(7) NOT NULL; UpdatedAtUtc datetime2(7) NOT NULL.
- SearchDeadlineAtUtc datetime2(7) NOT NULL.
- RetainUntilUtc datetime2(7) NULL; null while searching. Set when the search outcome is matched/no-opponent/cancelled/expired/started; a matched ticket remains actionable only until its existing ticket expiry.
- CHECK matched/started requires MatchId; searching/no-opponent/cancelled/expired has no dangling reference rule. A cancelled row may retain MatchId to preserve ticket audit linkage.
- Index active deadline scans on (Status, SearchDeadlineAtUtc) INCLUDE (PlayerId, MatchId).
- Index bounded cleanup on (RetainUntilUtc, SearchId) for non-null retention timestamps.
- Add named status constraint CK_PvpMatchSearches_Status and FK constraints.

Alter dbo.PvpMatches status constraint CK_PvpMatches_Status to also allow started. Existing statuses, ExpiresAtUtc values and rows remain valid; the existing 10 minute deadline continues to apply after start.

## Repository Contract
Implement named methods in pvpRepository.js for:
1. claimSearch(transaction, {searchId, playerId, nowUtc, deadlineUtc}) — insert searching row once under serializable/UPDLOCK,HOLDLOCK semantics; return created or the existing owned state. A SearchId owned by another PlayerId returns not-found/conflict without disclosing its data.
2. getSearch(pool, {searchId, playerId, nowUtc, lock}) — return only the owner’s non-logically-expired row. With lock=true it uses the same UPDLOCK,HOLDLOCK pattern used by selectMatch.
3. attachSearchMatch(transaction, {searchId, playerId, matchId, nowUtc, retainUntilUtc}) — atomically bind the issued match and transition searching to matched; set UpdatedAtUtc and RetainUntilUtc to the match's existing ExpiresAtUtc. If the issued match has already expired, expire it and retain the search as expired.
4. cancelSearch(transaction, {searchId, playerId, nowUtc, retainUntilUtc}) — lock search then match in a consistent order. searching becomes cancelled; matched + issued/unexpired becomes cancelled and match expired; matched + ticket already expired becomes expired; started returns already-started; terminal repeats return their current state.
5. startSearchMatch(transaction, {searchId, matchId, playerId, nowUtc, retainUntilUtc}) — verify owner and linkage; issued/unexpired becomes started and search becomes started with RetainUntilUtc = nowUtc + 10 minutes; leave the match's original ExpiresAtUtc unchanged. Already-started is idempotent; cancelled/expired/missing/expired ticket cannot start.
6. loadSearchTicket(pool or transaction, {searchId, playerId}) — load an issued/started linked match and snapshots only for the owning player, returning the same ticket shape needed by matchmakingService.

Started matches block candidate reuse for every simulator/balance version until their original ticket expiry. A version change may expire an issued ticket, but must not invalidate a started match before its deadline.

The methods must not commit transactions themselves. Match creation and attachSearchMatch execute in one caller-owned transaction. Cancellation and start both lock the search row before the match row so the first committed transition wins.

## Files and Symbols
- api/migrations/008-pvp-search-state.sql — create PvpMatchSearches and alter PvpMatches status constraint.
- api/src/repositories/pvpRepository.js — add claimSearch, getSearch, attachSearchMatch, cancelSearch, startSearchMatch, loadSearchTicket; include started in active-match exclusion and issued-or-started behavior where appropriate.
- api/test/database/schema-contract.test.js — require migration 008 and assert new table, columns, FK/index/status constraints, and started match state.
- api/test/pvp/pvpRepository.test.js — cover SQL parameters, owner scoping, lock order, conditional transitions, retained MatchId on cancellation, and idempotent repeated start/cancel.
- api/test-support/pvp.js — add in-memory search rows and transaction behavior only if required by existing service tests.

## Acceptance Criteria
- Migration is additive and does not rewrite existing match records or their current ExpiresAtUtc.
- The same SearchId can have only one database row; ownership is bound to one PlayerId.
- Only one transaction can transition searching to matched/cancelled, or matched to started/cancelled.
- A cancelled issued match becomes expired in the same transaction and can re-enter candidate selection.
- Started matches continue blocking candidate reuse until normal match completion/expiry behavior resolves them.
- Search status reads after RetainUntilUtc are logically hidden even if physical cleanup has not run. A matched row's RetainUntilUtc is its unstarted ticket expiry; cancelled/started transitions extend retention 10 minutes from their transition.
- Repository methods return explicit transition kinds; no caller infers success from affected rows without checking the resulting state.

## Validation Result
- node --test api/test/database/schema-contract.test.js api/test/pvp/pvpRepository.test.js — 25 passed.
- npm run check --prefix api — passed.

## Validation Commands
- node --test api/test/database/schema-contract.test.js api/test/pvp/pvpRepository.test.js
- npm run check --prefix api

## Commit
Plan: 2026-10-26-pvp-search-cancel
Phase: P01-pvp-search-cancel
Task: P01-T01-search-state-schema
Commit message: feat(pvp): persist cancellable matchmaking search state
