# Plan: 비동기 PvP 검색 취소

## Goal
비동기 PvP 검색에 재시도 가능한 취소 흐름을 추가한다. 검색별 상태를 DB에 저장하고, 같은 검색 ID로 시작·취소·상태 확인을 멱등 처리한다. 티켓이 발급된 뒤에도 PvpScene의 서버 시작 확인 전까지 취소할 수 있으며, 취소와 시작은 DB transaction에서 먼저 커밋한 쪽이 결정한다.

## Status: complete

## Confirmed Decisions
- 저장된 캐릭터·장비 snapshot을 대상으로 하는 현재의 비동기 PvP와 매칭 범위, 레이팅 규칙, 60초 검색 제한을 유지한다.
- 클라이언트는 검색마다 UUID를 만들고, 시작·취소·상태 확인 재시도에 같은 ID를 쓴다. ID는 브라우저 메모리에만 보관한다.
- 서버는 검색 ID와 계정 소유자, 검색 상태, 연결된 매치 ID를 저장한다. 같은 ID의 재전송은 검색 루프나 티켓을 중복 생성하지 않는다.
- 서버는 검색 상태를 최대 5초 간격으로 확인한다. 취소가 확정될 때까지 클라이언트 검색 창을 유지하며, 응답이 끊기면 같은 ID로 상태 확인·취소를 재시도한다.
- PvpScene 진입 시 매치 시작 API를 부른다. 취소와 시작은 transaction에서 경합하며, 취소가 먼저면 issued 매치를 만료시키고 레이팅을 반영하지 않는다. 시작이 먼저면 취소를 거부한다.
- 검색 종료 상태는 terminal 시각부터 10분 뒤 논리 만료한다. 기존 일일 정리 작업에서 물리 삭제하며, 물리 행은 논리 만료 뒤 최대 약 24시간 더 남을 수 있다.
- 새로고침·브라우저 종료 뒤 검색 복구, 키보드·터치 입력 개선, 전투 replay·판정·레이팅 변경, Azure 배포 및 운영 DB migration 실행은 범위 밖이다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | in_progress | 검색 상태 schema와 transaction 경계를 추가하고, 인증된 API·클라이언트 취소 흐름·일일 정리를 연결한다. | [P01](../phases/2026-10-26-pvp-search-cancel/P01-pvp-search-cancel/phase.md) |

## Ordering and Dependencies
- P01-T01은 검색 상태 테이블과 매치 started 상태를 먼저 정의하고 repository transaction 동작을 제공한다.
- P01-T02는 T01 저장 계약 위에 검색 시작·상태·취소·시작 API와 멱등 서비스를 구현한다. 매치 결과는 started 이후에만 처리한다.
- P01-T03은 고정된 API 계약을 cloudSaveClient, pvpClient, TownScene, PvpScene에 연결한다. 검색 ID는 씬 간 데이터로 전달하며 영속 저장하지 않는다.
- P01-T04는 검색 종료 상태의 RetainUntilUtc 기준 삭제를 기존 일일 retention 작업에 추가한다. 모든 cleanup 작업이 기존 전체 배치 한도 10회를 공유하므로 검색 테이블이 다른 정리를 굶기지 않도록 한도를 배분한다.
- 각 Task의 검증은 해당 청사진에 기록한다. 계획 수립에서는 테스트나 빌드를 실행하지 않는다.

## Out of Scope
- 실시간 대기자 매칭, 매칭 후보·rating window·기존 10분 ticket TTL·60초 전투 규칙 변경.
- 결과 검증·rating 알고리즘·상대 snapshot·PvP 이력 정책 변경.
- 새로고침 복구, 브라우저 저장소 기반 검색 ID 복원, 다중 탭 조율.
- 전투·결과·레벨업 키보드 탐색, 전투 조작 안내, 모바일 가로 화면 가독성 개선.
- Azure 인프라 변경, 운영 데이터 migration 실행, timer 배포·실환경 확인.

## Regression Traps
- SearchId만으로 상태를 노출하지 말고 인증된 PlayerId 소유권을 모든 read/write에서 확인한다.
- 검색 시작 재시도가 진행 중인 동일 검색에 두 번째 60초 loop를 만들지 않아야 한다. 검색 row 생성과 loop 소유권 획득은 transaction에서 한 번만 성공해야 한다.
- 티켓 생성과 검색 row의 matched/MatchId 연결은 원자적으로 커밋해야 한다. 연결 실패로 검색은 searching인데 issued 매치만 남는 상태를 만들지 않는다.
- 취소와 시작 API는 동일 검색 row 및 매치 row를 같은 순서로 잠가 deadlock 가능성을 줄이고, 먼저 커밋한 terminal transition을 뒤 요청이 되돌리지 않게 한다.
- 취소된 issued 매치를 expired 처리해야 상대가 다시 후보가 된다. 이미 started된 매치는 취소·만료시켜 레이팅 회피에 이용할 수 없어야 한다.
- 결과 제출은 started 상태만 처음 처리하고, 완료 결과의 기존 재시도 멱등 계약은 보존한다.
- 취소 응답을 못 받은 클라이언트는 같은 SearchId로 상태를 확인한다. 확인 전에는 새 검색을 열거나 이전 ticket으로 전투를 시작하지 않는다.
- terminal 시각과 RetainUntilUtc는 서버 UTC 기준으로 저장한다. 일일 cleanup의 전체 최대 10 batch 제한을 그대로 존중하고, 각 테이블이 영구 기아 상태가 되지 않게 작업 간 배분을 검증한다.

## Open Implementation Notes
- 검색 상태 테이블에는 SearchId uniqueidentifier PK, PlayerId uniqueidentifier FK, Status nvarchar(16), MatchId nullable uniqueidentifier FK, CreatedAtUtc/UpdatedAtUtc/SearchDeadlineAtUtc/RetainUntilUtc datetime2(7)을 둔다. RetainUntilUtc는 검색 결과가 확정될 때 설정하고 cancel/start 같은 terminal transition에서 다시 10분 연장한다.
- 검색 상태는 searching, matched, started, cancelled, no-opponent, expired로 제한한다. PvpMatches.Status에 started를 추가한다.
- POST search에는 {searchId}; GET search/{searchId}는 상태와 matched/started ticket을 반환한다. POST search/{searchId}/cancel은 취소 결과를 반환한다. POST matches/{matchId}/start에는 {searchId}를 전달해 ticket과 검색 row 연결 및 소유권을 확인한다.
- Search ID 상태 API의 구체 응답 코드와 transaction 순서는 P01 Task 청사진에 고정한다.
