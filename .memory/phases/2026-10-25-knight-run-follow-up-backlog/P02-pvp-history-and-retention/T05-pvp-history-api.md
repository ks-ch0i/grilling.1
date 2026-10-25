# Task: T05 PvP 최근 경기 API

## Status: pending

## Goal
인증한 플레이어가 자신의 완료된 PvP 경기 요약을 최신순 10개씩 페이지 조회할 수 있도록 Azure Functions API와 SQL repository를 추가한다. 대전 중 입력 로그와 상대 snapshot은 응답에 노출하지 않는다.

## Decision Summary
- Endpoint: GET /api/pvp/matches/history?page=1; page는 1부터 시작하고 page size는 서버 상수 10이다.
- Player1과 Player2 양쪽 관점으로 결과를 정규화한다. 기존 PvP 규칙·평점·데이터는 변경하지 않는다.

## Implementation

### I01. SQL 경기 이력 조회

- Related Files:
  - api/src/repositories/pvpRepository.js :: getMatchHistory — PvpMatches 조회 및 플레이어 관점 정규화; modify
  - api/migrations/003-pvp-history-indexes.sql :: Player1/Player2 이력 인덱스; new
  - api/test/pvp/pvpRepository.test.js :: Player1·Player2·페이지 쿼리 검증; modify

#### Details
- Signatures & Types:
  ~~~javascript
  export async function getMatchHistory(pool, playerId, { offset, limit })
  // returns Array<{
  //   MatchId, CompletedAtUtc, OpponentDisplayName, Outcome, Rated,
  //   RatingBefore, RatingAfter, OpponentRatingAfter
  // }>
  ~~~
- Data & Schema Fields:
  - 읽는 테이블: dbo.PvpMatches (MatchId, Player1Id, Player2Id, Outcome, RatingBefore1/2, RatingAfter1/2, CompletedAtUtc, Status).
  - 상대 이름은 dbo.Players.DisplayName에서 읽고 NULL은 Adventurer로 정규화한다.
  - Rated는 dbo.PvpRatedPairDays에 MatchId가 있는지로 판정한다.
  - 응답은 snapshots, InputJson, Seed, Entra identity를 포함하지 않는다.
- Execution Flow / Logic:
  1. PlayerId가 Player1Id인 completed 행과 Player2Id인 completed 행을 UNION ALL로 조회한다. Player1Id와 Player2Id는 스키마상 서로 다르므로 중복 행은 생기지 않는다.
  2. Player1 관점에서는 Outcome과 RatingBefore1/RatingAfter1/RatingAfter2를 사용한다. Player2 관점에서는 win/loss를 뒤집고 RatingBefore2/RatingAfter2/RatingAfter1을 사용한다. draw는 그대로 둔다.
  3. CompletedAtUtc DESC, MatchId DESC로 정렬한다. offset부터 limit+1개를 읽어 서비스가 hasNext를 계산할 수 있게 한다.
  4. 새 인덱스는 (Player1Id, Status, CompletedAtUtc DESC, MatchId DESC) 및 (Player2Id, Status, CompletedAtUtc DESC, MatchId DESC)로 만든다. 두 인덱스에는 상대 ID, Outcome, 양쪽 RatingBefore/After를 INCLUDE한다.
  5. Migration은 sys.indexes에서 이름을 확인해 이미 존재하는 인덱스를 중복 생성하지 않는다.

### I02. 서비스·인증 Function endpoint

- Related Files:
  - api/src/services/pvpResultService.js :: getPlayerMatchHistory, createPvpResultService — identity resolve와 DTO 작성; modify
  - api/src/functions/pvp.js :: createPvpHandlers.history — query validation, auth, 오류 응답; modify
  - api/src/functions/pvpMatches.js :: registerPvpMatchFunctions — GET history route 등록; modify
  - api/test/pvp/pvpHistoryService.test.js :: 서비스·DTO·관점 정규화; new
  - api/test/pvp/pvpFunctions.test.js :: route, auth, query errors; modify

#### Details
- Data & Schema Fields:
  - Success body: { page: number, pageSize: 10, hasPrevious: boolean, hasNext: boolean, items: Array<HistoryItem> }.
  - HistoryItem: { matchId: UUID string, completedAtUtc: ISO-8601 string, opponentDisplayName: string, outcome: 'win'|'loss'|'draw', rated: boolean, ratingBefore: integer, ratingAfter: integer, opponentRatingAfter: integer }.
  - Page query는 생략 시 1이다. 허용 범위는 정수 1..100000이다.
- **Execution Flow / Logic**:
  1. createPvpHandlers의 history handler는 기존 withUser 인증 흐름을 재사용한다. 인증 전에는 SQL pool을 열지 않는다.
  2. page query를 /^([1-9][0-9]*)$/ 형태로 검증하고 safe integer 및 100000 이하인지 검사한다. 실패하면 HTTP 400 { code: 'invalid-history-page' }를 반환한다.
  3. 인증 identity로 기존 repository.findPlayerIdByIdentity를 호출한다. 등록 플레이어가 없으면 빈 items, pageSize 10, hasPrevious/hasNext false로 HTTP 200을 반환한다.
  4. repository에 offset=(page-1)*10, limit=10을 전달하고 실제 최대 10개를 반환한다. 11번째 조회 행이 있으면 hasNext=true, page>1이면 hasPrevious=true다.
  5. 401/403/503/500 응답과 안전한 errorId 기록은 같은 PvP function 규약을 따른다. DB 예외를 상세 body로 노출하지 않는다.
  6. pvpMatches.js에 GET route pvp/matches/history를 등록한다. 기존 POST search/result 및 topFive route는 그대로 둔다.

### I03. API 회귀 검증

- Related Files:
  - api/test/pvp/pvpRepository.test.js :: Player1/Player2 union, 결과 역전, empty row, limit+1; modify
  - api/test/pvp/pvpHistoryService.test.js :: page DTO와 상대 관점; new
  - api/test/pvp/pvpFunctions.test.js :: 401/403, 잘못된 page 400, 정상 200, transient SQL 503; modify

#### Details
- Player1이 win인 행을 Player2에게는 loss로 반환하고 RatingBefore/After를 올바르게 뒤집는다.
- draw의 outcome은 두 관점에서 동일하며 Rated flag는 RatedPairDays join 결과를 따른다.
- expired/rejected/issued 경기는 조회에서 제외한다.
- page=1 기본값, page 2 offset, 11번째 행을 이용한 hasNext, 마지막 페이지 empty items를 검증한다.
- SnapshotJson과 InputJson은 응답 JSON에서 찾을 수 없어야 한다.

## Acceptance Criteria
- [ ] 인증 사용자는 자기 계정과 연결된 completed match만 조회한다.
- [ ] Player1/Player2 모두 자기 관점의 승패와 rating delta를 받는다.
- [ ] 요청당 요약은 최대 10개이며 페이지 메타데이터가 정확하다.
- [ ] API 응답에는 입력 로그, 스냅샷, seed, 상대 계정 식별자가 없다.
- [ ] 기존 match submission과 leaderboard endpoint 응답은 바뀌지 않는다.

## Validation
- npm --prefix api test — 전체 Functions API 테스트 통과.
- npm --prefix api run check — Function entry syntax 검사 통과.

## Commit Message
~~~text
feat(pvp): add authenticated paginated match history

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P02-pvp-history-and-retention
Task: T05-pvp-history-api

- Return the latest completed matches from either player perspective
- Add indexes and omit replay payloads from history responses
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
