# Task: T07 PvP 상세 데이터 보관 정책 결정안

## Status: pending

## Goal
PvP 결과 요약, 원본 입력 로그, 경기 당시 전투 스냅샷에 서로 다른 보관 기준이 필요한지 조사하고, 실제 데이터 삭제 전에 사용자가 결정할 수 있는 정책안과 후속 구현 범위를 제시한다.

## Decision Summary
- 이 Task는 schema·code 기반 읽기 전용 조사이며 SQL row나 payload를 삭제·수정하지 않는다.
- 구체적인 보관 기간은 자동으로 정하지 않는다. 요약 기록과 원본 재생 자료의 보관 기간을 분리해 옵션과 권고안을 제시한다.

## Implementation

### I01. 보관 데이터·제약 목록 작성

- Related Files:
  - api/migrations/001-initial-schema.sql :: PvpMatches, PvpRatedPairDays — 컬럼, index, foreign key; read-only
  - api/src/repositories/pvpRepository.js :: match insert/result/history queries — 현재 데이터 사용처; read-only
  - .memory/decisions/2026-10-25-knight-run-follow-up-work.md :: D06 — 사용자 범위; read-only

#### Details
- Data & Schema Fields:
  - 원본 대전 자료: PvpMatches.Player1SnapshotJson, Player2SnapshotJson, InputJson, Seed, SimulatorVersion, BalanceVersion.
  - 결과 요약: Outcome, RatingBefore1/2, RatingAfter1/2, IssuedAtUtc, CompletedAtUtc, Status.
  - 제한 기록: PvpRatedPairDays.MatchDateUtc, LowPlayerId, HighPlayerId, MatchId.
- **Execution Flow / Logic**:
  1. 각 컬럼이 결과 화면, 경기 이력, 재생 검증, 같은 UTC 날짜 동일 상대 레이팅 중복 방지에 쓰이는지 표로 작성한다.
  2. PvpRatedPairDays.MatchId는 PvpMatches.MatchId를 참조하는 외래키다. 부모 경기 행을 물리 삭제하려면 제한 기록과 중복 방지 규칙도 함께 바꿔야 함을 명시한다.
  3. 현재 API는 경기 결과 제출·랭킹 조회를 제공하지만 history listing은 새 구현이며, 이 Task는 삭제 endpoint·timer·실제 DB cleanup을 추가하지 않는다.
  4. 실제 SQL database가 이 workspace에서 접근 가능하다고 가정하지 않는다. schema 기반 보관량 리스크만 설명하고 운영 데이터의 용량을 추정하지 않는다.

### I02. 정책 선택 문서 작성

- Related Files:
  - .memory/decisions/YYYY-MM-DD-pvp-data-retention.md :: 보관 기간별 선택과 후속 작업 승인 기록; new at execution date

#### Details
- **Policy choices to compare**:
  - 경기 요약 행 보관 기간.
  - InputJson 보관 기간.
  - Player1SnapshotJson/Player2SnapshotJson 보관 기간.
  - payload 삭제 또는 익명화 후 PvpMatches 요약 row 유지 여부.
- **Execution Flow / Logic**:
  1. 원본 입력·스냅샷에 대한 30일, 90일, 365일 보관 예시와 무기한 보관안을 비교하되 이는 선택지이지 승인값이 아님을 표시한다.
  2. 요약 결과를 유지하고 원본 JSON만 삭제/정리하는 선택은 현재 snapshot columns가 NOT NULL이고 RatedPairDays가 경기 행을 참조하므로 schema/data migration이 필요할 수 있음을 설명한다.
  3. 모든 선택지에 이력 화면 영향, 재생·분쟁 확인 가능성, SQL 저장량, 같은 상대 일일 중복 방지 규칙 영향을 적는다.
  4. 권고안을 제시하고 사용자에게 기간과 요약/payload의 처리 방식을 선택해 달라고 요청한다. 선택 전에는 cleanup SQL이나 자동화 구현을 시작하지 않는다.

## Acceptance Criteria
- [ ] 보관 대상과 각 데이터의 현재 사용처가 목록화된다.
- [ ] RatedPairDays 외래키·일일 중복 방지 규칙과 물리 삭제의 영향을 설명한다.
- [ ] 요약과 원본 payload의 보관기간 선택지가 분리되어 제시된다.
- [ ] 사용자 선택 전 데이터가 변경되지 않고, 후속 cleanup 구현에 필요한 결정을 구체적으로 요청한다.

## Validation
- SQL migration 및 repository 사용처를 정적으로 대조한다.
- 결과 문서에 실제 운영 데이터 접근·용량 측정을 했다고 주장하지 않는다.
- cleanup, SQL migration, timer function은 이 Task에서 실행하지 않는다.

## Commit Message
~~~text
docs(pvp): define match data retention options

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P02-pvp-history-and-retention
Task: T07-pvp-retention-policy

- Inventory match summary and replay payload dependencies
- Present retention options without deleting stored match data
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
