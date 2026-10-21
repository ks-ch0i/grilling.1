# Task: T05 비동기 PvP API

## Status: done

## Goal
변경 시 공개한 캐릭터·장비 스냅샷으로 PvP 티켓을 만들고, 서버 재생 결과로 매치와 양쪽 Elo를 원자적으로 확정한다.

## Decision Summary
- 상대는 snapshot 상태로 고정된 몸통 접촉 타깃이다. 상대 위치 이동, 추격 AI, 실시간 상대 접속은 없다.
- 클라이언트는 본인 이동 입력만 기록한다. 서버가 양쪽 스냅샷과 시드로 60초 결과를 재생한다.
- 같은 unordered 상대 쌍의 UTC 날짜별 첫 rated 결과만 점수에 반영하며 다른 결과는 저장할 수 있어도 레이팅은 바꾸지 않는다.

## Implementation

### I01. 공개 스냅샷과 매치 검색
- Related Files:
  - api/src/services/playerSnapshotService.js :: publishSnapshot — 입력 검증과 revision 관리; new.
  - api/src/functions/playerSnapshots.js :: PUT /api/pvp/snapshot — 내 스냅샷 갱신; new.
  - api/src/services/matchmakingService.js :: findOpponent, createMatch — queue window와 ticket; new.
  - api/src/functions/pvpMatches.js :: POST /api/pvp/matches/search — 매치 발급; new.
  - api/test/pvp/matchmakingService.test.js :: snapshot/search cases; new.
- Details:
  - PUT body는 { expectedSaveRevision: integer }다. player identity는 JWT AuthContext로만 얻고 snapshot 내용은 해당 계정의 CloudSaves row에서 읽어 서버가 만든다.
  - 공개 Snapshot DTO: { revision: integer; character: { level: integer; baseStats: PlayerBaseStats }; equipment: Record<GearSlot,GearItem|null>; combat: PlayerCombatSnapshot; publishedAtUtc: server timestamp }.
  - 서버는 current shared rules로 CloudSave state에서 combat stats/effects를 derive한다. client revision, stats, rating 필드는 받지 않는다. 저장 자체가 client-originated라는 accepted risk는 유지한다.
  - PUT은 expectedSaveRevision과 CloudSaves revision이 같을 때만 canonical JSON SHA-256이 달라지는지 계산해 revision을 +1 하고 updated event를 발행한다. 현재 local save가 cloud 저장 성공 후 browser가 해당 endpoint를 호출한다.
  - Rating row가 없는 플레이어는 1000으로 초기화한다. 매칭 후보는 자기 자신·현재 UTC day에 이미 rated pair인 사용자·snapshot 없는 사용자를 제외한다.
  - 초기 window ±100 Elo, 대기 5초마다 ±100, 최대 ±500. 60초 동안 후보가 없으면 404 code='no-opponent'를 반환하고 클라이언트가 재검색한다. 이 숫자는 matchmaking configuration으로 분리한다.
  - Match ticket은 matchId, player ID 쌍, 양쪽 snapshot revision/JSON, seed, simulatorVersion=1, issuedAtUtc, expiresAtUtc=issued+10 minutes, status='issued'다. 양쪽 스냅샷의 player stat/effects를 재생에 고정한다.

### I02. 결과 재생, HP 판정, Elo 트랜잭션
- Related Files:
  - api/src/services/pvpResultService.js :: submitPvpResult, calculateElo — result와 rating update; new.
  - api/src/repositories/pvpRepository.js :: completeRatedMatch — SQL transaction; new.
  - api/src/functions/pvpMatches.js :: POST /api/pvp/matches/{matchId}/result, GET /api/rankings/pvp/top — result/ranking; modify.
  - api/test/pvp/pvpResultService.test.js :: rating, tie, duplicate day, replay; new.
- Details:
  - Result body는 { inputs: RunInputEvent[] }이며 match owner 이외 접근은 404로 숨긴다. 클라이언트의 winner, HP, Elo, elapsed 필드는 허용하지 않는다.
  - Server calls shared replayPvpRun(ticket, playerSnapshot, opponentSnapshot, inputs). 상대는 고정 x 위치의 contact target이고 별도 이동 AI는 없다. 제한 시간은 60,000ms다.
  - 승자는 remainingHp/maxHp 비율로 정한다. 비율이 수학적으로 같으면 draw이며 양쪽 Elo는 바꾸지 않는다.
  - Elo: E1=1/(1+10^((R2-R1)/400)), score1은 win=1/draw=0.5/loss=0, newR1=round(R1+32*(score1-E1)), newR2=round(R2+32*(score2-E2)).
  - transaction은 match 상태, daily pair key, 두 rating을 잠금 상태에서 읽고 PvpMatches 결과와 두 PvpRatings를 모두 갱신한다. UTC day pair key가 이미 존재하면 match는 unrated 완료로 저장하고 레이팅을 그대로 둔다.
  - 동시에 같은 상대 쌍 결과 두 개가 들어와도 primary key 덕분에 하나만 rated가 된다. 이미 완료한 동일 payload는 저장 결과를 반환한다. 다른 payload 재사용은 409다.
  - GET /api/rankings/pvp/top은 Rating DESC, UpdatedAtUtc ASC, PlayerId ASC 순으로 5개를 반환한다.
  - 경기 및 rating 변경 후 SignalR에 event를 보내고, 무승부는 결과 알림만 보낸다.

## Acceptance Criteria
- [x] 클라이언트 제출 winner/HP/Elo 없이 서버 재생 결과만 DB에 반영된다.
- [x] 스냅샷은 공개 시점 revision으로 고정되고 경기 도중 수정되지 않는다.
- [x] HP 비율 승패와 Elo 양쪽 변경이 같은 SQL transaction에서 끝난다.
- [x] UTC pair key가 하루 한 rated 결과만 허용한다.

## Validation
    npx --yes node@22 --test (working directory: api)
    npx --yes node@22 --test test/game-rules-simulation.test.js (repository root)
    npm run build (repository root)

SQL migration contract was checked by the API suite. No Azure SQL instance was changed or used; live database validation remains in the separately gated P04 rollout.

## Commit Message
    feat(api): add snapshot based asynchronous PvP ratings

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P01-simulation-and-api
    Task: T05-pvp-api

    - Match against immutable opponent snapshots with server replay
    - Apply daily pair guard and transactional Elo updates

## Progress
- [x] 구현 완료
- [x] 검증 통과: API 56 tests and shared simulator 14 tests on Node 22; production build succeeded.
- commit: pending
