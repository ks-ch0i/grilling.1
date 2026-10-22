# Task: T08 PvP 스냅샷과 매치 v2

## Status: pending

## Goal
새 밸런스의 PvP 스냅샷끼리만 매칭하고, 새 매치를 simulatorVersion2/balanceVersion2로 저장·재생 검증한다. v1 완료 매치와 Elo 레이팅 기록은 보존한다.

## Decision Summary
- 오래된 PlayerSnapshots는 balanceVersion1로 취급하고 v2 매칭 후보에서 제외한다. 새 클라이언트의 새 저장/스냅샷 발행 이후에만 후보가 된다.
- 기존 PvpMatches는 버전1로 보존한다. 배포 후 남은 v1 진행 매치는 새 API에서 완료될 수 없으며, 이미 완료된 매치는 바꾸지 않는다.
- PvP Elo는 하나의 기존 레이팅 풀을 유지하고 점수식, daily rated-pair gate, 보드 정렬을 바꾸지 않는다.

## Implementation

### I01. PvP snapshot/ticket 버전 저장
- Related Files:
  - api/migrations/002-pvp-balance-version.sql :: PlayerSnapshots/PvpMatches BalanceVersion columns and SchemaVersions row; new.
  - api/src/services/playerSnapshotService.js :: publish current snapshot with version2; modify.
  - api/src/services/matchmakingService.js :: v2 candidate and match ticket; modify.
  - api/src/domain/gameVersions.js :: shared SIMULATOR_VERSION/BALANCE_VERSION; T07 output; read-only.
  - api/src/repositories/pvpRepository.js :: snapshot/match select, insert, update DTOs and SQL; modify.
  - api/src/services/pvpResultService.js :: stored-version and current-version result gate; modify.
  - packages/game-rules/src/simulation.js :: assertPvpTicket/createPvpRun/replayPvpRun ticket version checks; modify.

#### Details
- Data & Schema Fields:
  - Add PlayerSnapshots.BalanceVersion int NOT NULL with default 1 and CK >=1. Existing rows are backfilled as 1; new API upserts explicit 2.
  - Add PvpMatches.BalanceVersion int NOT NULL with default 1 and CK >=1. Existing rows remain 1; new tickets explicitly store 2.
  - New PvP ticket JSON includes simulatorVersion=2 and balanceVersion=2 in addition to existing matchId, seed, participants, snapshot revisions, timestamps and time limit.
- Execution Flow / Logic:
  1. Migration 002 adds both columns with WITH VALUES/default 1 and records schema version2. It is applied after 001 and does not update existing match snapshots, outcomes, or ratings.
  2. Player snapshot publication derives combat stats from the current v2 cloud save and writes BalanceVersion=2. Do not trust a caller-supplied version to relabel an old snapshot.
  3. findOpponentCandidate requires snapshot BalanceVersion=2. createMatch rechecks both locked snapshots' revision and BalanceVersion=2 inside its transaction before issuing a ticket.
  4. New match inserts record both version columns. Result service compares the stored row and ticket/current constants before replay. If a v1 issued ticket remains, mark/reject it using the existing stale/invalid result path; do not rate it.
  5. Completed v1 records are never replayed or rewritten. Rating updates for valid v2 matches continue to use the current shared Elo pool.
  6. Keep participant identity, snapshot revision locking, one active match/player, ticket expiry, rated-pair-day uniqueness and transactional two-player Elo update unchanged.

### I02. PvP upgrade compatibility tests
- Related Files:
  - api/test/database/schema-contract.test.js :: migration 002 and version columns; modify.
  - api/test/pvp/matchmakingService.test.js :: only v2 snapshots produce version2 ticket; modify.
  - api/test/pvp/pvpResultService.test.js :: valid v2 replay and stale v1 gate; modify.
  - api/test/pvp/pvpRepository.test.js :: migration fields and query params; new.
  - test/game-rules-simulation.test.js :: pvp ticket version2; modify.
  - test/pvp/pvpClient.test.js :: consume version2 ticket; modify.

#### Details
- Migration contract tests require existing rows to default to version1 and new writes to pass version2.
- Candidate query excludes v1 snapshots; transaction recheck catches a snapshot version change between search and match creation.
- A current v2 match issues and replays with version2; a v1 issued match cannot change Elo or complete under current rules.
- Existing completed PvpMatches and PvpRatings remain unchanged and top-five/me-rank contracts remain the same.

## Acceptance Criteria
- [ ] Existing snapshots/matches are retained and labeled v1 by the additive SQL migration.
- [ ] New v2 clients only match with v2 snapshots and receive v2 tickets.
- [ ] Stale v1 in-flight tickets do not update either player's rating.
- [ ] Completed v1 match rows and existing Elo values remain intact; valid v2 matches retain the existing Elo transaction behavior.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/game-rules-simulation.test.js test/pvp/pvpClient.test.js — shared PvP simulator and client contracts pass.
- npm --prefix api test — SQL contract, snapshot version filter, match issuance, stale ticket and Elo regression tests pass.

## Commit Message
~~~text
feat(pvp): isolate snapshots by balance version

Plan: 2026-10-22-character-gear-balance
Phase: P02-online-compatibility
Task: T08-pvp-v2-snapshots-and-matches

- Tag PvP snapshots and matches with balance version 2
- Preserve v1 matches and shared Elo while rejecting stale tickets
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
