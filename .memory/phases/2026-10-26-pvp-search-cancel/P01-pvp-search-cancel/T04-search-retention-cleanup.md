# Task P01-T04: 검색 상태 retention 정리

## Status: planned

## Goal
terminal PvP 검색 상태를 RetainUntilUtc 이후 기존 일일 cleanup timer에서 제한된 batch로 물리 삭제한다. 기존 cleanup 총 한도 10 batch를 유지하고 각 cleanup operation이 반복적으로 기회를 받도록 한다.

## Dependencies
- Requires P01-T01 table and RetainUntilUtc.
- Requires P01-T02 terminal transition timestamps.

## Behavior
- Search rows are eligible for physical deletion only when Status is terminal (matched, started, cancelled, no-opponent, expired), RetainUntilUtc is non-null, and RetainUntilUtc <= NowUtc.
- Searching rows are never deleted by retention. Their server-side lifetime is bounded by SearchDeadlineAtUtc; the lifecycle service must mark them no-opponent/expired before cleanup eligibility.
- A search ticket's 10 minute issuance lifetime remains unchanged. Matched status uses the ticket lifetime as the maximum time its linked search state remains actionable; cancellation/start transition resets RetainUntilUtc to 10 minutes after that terminal transition.
- Keep PVP_RETENTION_CLEANUP_SCHEDULE at daily 03:15 UTC and existing batchSize=500, maxBatches=10 total budget.
- Expire overdue matches in both issued and started states at their unchanged original ExpiresAtUtc.
- Add matchesExpired and searchRowsDeleted to service/function completion summary.
- Run the four cleanup operations fairly in rounds, granting at most one batch per unfinished operation per round until all return zero or the shared 10-batch budget is spent. An operation with zero rows is removed from later rounds.
- Emit per-operation counts and total batch count so a growing backlog is visible in existing structured timer logs. The summary contains matchesExpired, payloadRowsDeleted, pairDayRowsDeleted, searchRowsDeleted and batches.

## Files and Symbols
- api/src/repositories/pvpRetentionRepository.js — rename expireOverdueIssuedMatchesBatch to expireOverdueActiveMatchesBatch for issued/started rows and add deleteExpiredSearchBatch(transaction, {nowUtc, batchSize}) using bounded DELETE TOP and returning validated RowsAffected.
- api/src/services/pvpRetentionService.js — add matchesExpired/searchRowsDeleted totals and fair round-robin batch scheduling across overdue-match expiry, payload deletion, pair-day deletion and search-row deletion; retain the global maxBatches validation.
- api/src/functions/pvpRetentionCleanup.js — preserve schedule and structured completion logging with the new count.
- api/test/pvp/pvpRetentionRepository.test.js — assert bounded search delete SQL, terminal-state filter and RetainUntilUtc predicate.
- api/test/pvp/pvpRetentionService.test.js — assert round-robin ordering, 10-batch cap, zero-work removal, totals and no starvation when every operation has backlog.
- api/test/pvp/pvpRetentionFunction.test.js — assert new summary field is logged and daily schedule remains unchanged.

## Acceptance Criteria
- No nonterminal searching record is physically deleted.
- A record is eligible at the exact RetainUntilUtc boundary and no earlier.
- A cleanup run never exceeds 10 total batches or 500 rows per batch.
- If all four operations have backlog, each receives a batch before any operation receives its second batch.
- Existing overdue match expiry, payload retention and pair-day cleanup continue to run under the same total budget.
- Cleanup is idempotent and reports actual expired-match/deleted-row totals and batches.
- A retained search record can be absent from GET after its logical retention deadline even if the daily timer has not physically removed it yet.

## Validation Commands
- node --test api/test/pvp/pvpRetentionRepository.test.js api/test/pvp/pvpRetentionService.test.js api/test/pvp/pvpRetentionFunction.test.js
- npm run check --prefix api

## Commit
Plan: 2026-10-26-pvp-search-cancel
Phase: P01-pvp-search-cancel
Task: P01-T04-search-retention-cleanup
Commit message: feat(pvp): clean up expired matchmaking search state
