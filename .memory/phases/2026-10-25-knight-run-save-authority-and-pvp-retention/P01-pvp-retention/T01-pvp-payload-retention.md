# Task: T01 PvP 상세 페이로드 분리와 결과 호환

## Status: done

## Goal
완료된 PvP 경기의 요약과 rated 여부를 영구 보존하면서 입력 로그와 양측 전투 snapshot을 별도 90일 payload 행으로 분리한다. payload가 정리된 뒤에도 이력 DTO는 유지되고 결과 재제출은 replay를 시도하지 않는다.

## Decision Summary
- `PvpMatches`는 영구 summary, `PvpMatchPayloads`는 만료 가능한 snapshot/input을 소유한다.
- terminal match payload만 terminal 시각부터 90일 뒤 정리 대상이다. issued match의 snapshot은 만료 전 계속 보존한다.

## Implementation

### I01. DB migration 및 저장소 row shape

- Related Files:
  - `api/migrations/004-pvp-payload-retention.sql` :: migration 4 — 새 payload 테이블 생성/복사와 summary rated backfill; new
  - `api/src/repositories/pvpRepository.js` :: `MATCH_COLUMNS`, `createMatch`, `selectMatch`, `completeRatedMatch`, `rejectMatch`, `getMatchHistory`; modify
  - `api/test/pvp/pvpRepository.test.js` :: INSERT/SELECT SQL 계약과 repository 결과; modify

#### Details
- **Signatures & Types**:
  ```js
  createMatch(transaction, input) -> Promise<{kind:'created'|'missing-player'|'snapshot-changed'|'already-rated-pair'|'active-match', row?: MatchSummaryRow}>
  getMatchForPlayer(pool, playerId, matchId) -> Promise<(MatchSummaryRow & { Player1SnapshotJson:string|null, Player2SnapshotJson:string|null, InputJson:string|null })|null>
  getMatchHistory(pool, playerId, {offset,limit}) -> Promise<MatchHistoryRow[]>
  ```
- **Data & Schema Fields**:
  - `PvpMatches.Rated bit NOT NULL DEFAULT(0)`: migration에서 `PvpRatedPairDays.MatchId`와 join해 기존 rated 경기 backfill.
  - 새 `dbo.PvpMatchPayloads`: `MatchId uniqueidentifier PRIMARY KEY/FK PvpMatches`, `Player1SnapshotJson nvarchar(max) NOT NULL`, `Player2SnapshotJson nvarchar(max) NOT NULL`, `InputJson nvarchar(max) NULL`. parent match 삭제 cascade는 추가하지 않는다.
  - migration은 기존 PvpMatches snapshot/input을 child table로 복사한 뒤 원본 세 열을 제거한다. 경기 요약의 결과·ratings·timestamp·status·version·seed·revision 필드는 유지한다.
- **Execution Flow / Logic**:
  1. migration transaction 안에서 `Rated`를 추가하고 pair-day join으로 backfill한다. child table 생성 후 모든 기존 match payload를 복사하고 row count를 대조한 다음 기존 payload 열을 삭제한다. version 4를 `SchemaVersions`에 기록한다.
  2. `createMatch`는 기존 snapshot revision/active match 검사를 유지하고 summary와 snapshot payload를 같은 transaction에서 삽입한다. payload `InputJson`은 NULL로 시작한다.
  3. `selectMatch`는 summary와 child payload를 한 번 읽되 payload가 삭제되면 세 payload 값이 NULL이다. `getMatchHistory`는 `PvpMatches.Rated`를 직접 반환하고 pair-day join을 제거한다.
  4. reject/complete 경로는 child row의 InputJson을 같은 transaction에서 설정한다. `completeRatedMatch`가 새 일일 rated 경기이면 summary의 `Rated=1`도 그 transaction에서 갱신한다. 재경기(non-rated)는 `Rated=0`으로 둔다.
  5. 결과 service에서 status `completed`/`rejected`인데 InputJson 또는 snapshot이 NULL이면 `410 {code:'match-payload-expired'}`를 반환한다. expired ticket은 기존 `match-expired` 응답을 유지한다. payload가 있으면 기존 동일 input 재시도 규칙과 replay를 유지한다.
- **Error & Exception Handling**: payload 삽입/요약 삽입 중 하나라도 실패하면 transaction 전체 rollback. 운영 순서상 migration 적용 전 새 API 코드를 실행하지 않는다.
- **State Transition & Return**: history DTO의 `rated`, 상대, outcome, rating before/after는 payload 보존 여부와 무관하게 기존 값과 같다.

### I02. 서비스 계약 회귀 검증

- Related Files:
  - `api/src/services/pvpResultService.js` :: `submitPvpResult`; modify
  - `api/test/pvp/pvpResultService.test.js` :: 만료 payload 재제출; modify
  - `api/test/pvp/pvpHistoryService.test.js` :: rated history; modify

#### Details
- terminal payload가 존재할 때 동일 입력은 기존 저장 결과, 다른 입력은 기존 409로 처리한다.
- terminal payload가 제거됐을 때 어떤 replay 호출도 발생하지 않고 410 `match-payload-expired`를 반환한다.
- summary history는 child row 없이도 영구 조회되며, 과거 pair-day 삭제 이후에도 `rated` 값이 변하지 않는다.
- issued match가 payload 없이 조회되는 상황은 정상 발급 흐름에서 불가능하도록 repository transaction 테스트로 방지한다.

## Acceptance Criteria
- [x] 모든 기존 PvP snapshot/input이 migration에서 child table로 보존되고 summary rated backfill이 완료된다.
- [x] 신규 match 발급·완료·거절은 summary와 payload를 일관되게 기록한다.
- [x] payload가 없는 terminal match는 replay 없이 명시적 410을 반환한다.
- [x] history 결과와 rated 표시는 payload와 pair-day row 정리 후에도 유지된다.

## Validation
- `node --test test/pvp/pvpRepository.test.js test/pvp/pvpResultService.test.js test/pvp/pvpHistoryService.test.js` (workdir: `api`) — 관련 API 테스트 통과
- `npm test` (workdir: `api`) — API 전체 테스트 통과
- SQL migration 정적 검토 — 복사 대상/삭제 대상, FK 및 version 4가 일치

## Commit Message
```text
feat(pvp): separate retained summaries from replay payloads

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P01-pvp-retention
Task: T01-pvp-payload-retention

- Keep rated match summaries after payload expiry
- Return explicit expiry for replay requests without retained input
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- Validation: focused PvP tests 25 passed; API suite 104 passed; migration contract passed.
- commit: pending
