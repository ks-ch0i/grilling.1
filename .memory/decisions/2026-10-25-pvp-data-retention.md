# PvP 경기 데이터 보관 정책 선택지

- 작성일: 2026-10-25
- 상태: **사용자 선택 필요** — 아래 권고는 검토안이며 보관 기간이나 삭제를 승인한 값이 아니다.
- 범위: schema와 코드의 정적 조사. 운영 SQL 데이터 접근·용량 측정, 데이터 수정·삭제, cleanup 자동화는 수행하지 않았다.

## 현재 저장 데이터와 사용처

| 분류 | 컬럼 | 현재 사용처 | 보관을 줄일 때의 영향 |
| --- | --- | --- | --- |
| 경기 요약 | `MatchId`, `Player1Id`, `Player2Id`, `Outcome`, `RatingBefore1/2`, `RatingAfter1/2`, `IssuedAtUtc`, `CompletedAtUtc`, `Status` | T05의 최근 경기 API는 완료 경기의 날짜, 상대 표시 이름, 승패, 평점, rated 여부를 만들 때 사용한다. match-result API도 소유자와 제출 결과를 조회한다. | 요약 행을 삭제하면 해당 경기의 이력과 결과 재조회가 사라진다. `PvpRatings`는 별도 테이블이므로 현재 상위 랭킹은 유지되지만 과거 경기 설명은 복구할 수 없다. |
| 입력 trace | `InputJson` | 제출 입력을 저장한다. 같은 match 재제출인지 다른 payload인지 비교해 completed/rejected 결과를 멱등 처리한다. | payload가 없어지면 현재 서비스는 같은 payload 비교와 재생 검증을 할 수 없다. 재시도 응답 규칙을 별도로 정해야 한다. |
| 전투 snapshot | `Player1SnapshotJson`, `Player2SnapshotJson`, snapshot revision | matchmaking 시점의 양측 전투 상태를 고정하고 서버가 제출 입력을 재생 검증할 때 사용한다. 두 JSON 컬럼은 현재 `NOT NULL`이다. | 컬럼을 비우려면 schema 변경이 필요하다. 이후 경기 결과 재검증과 동일 payload 재제출 경로가 달라져야 한다. |
| 재생 metadata | `Seed`, `SimulatorVersion`, `BalanceVersion` | deterministic 재생 티켓을 구성하고 현재 지원 버전인지 검증한다. `Seed`는 1..2^32−1 범위다. | JSON보다 저장량은 작지만 원본 snapshot·input 없이 단독으로는 재생할 수 없다. 버전 추적이나 사고 분석에 계속 쓸지 결정해야 한다. |
| rated 일일 제한 | `PvpRatedPairDays.MatchDateUtc`, `LowPlayerId`, `HighPlayerId`, `MatchId` | UTC 날짜별 두 플레이어 조합의 첫 rated 경기만 적용한다. matchmaking 조회 및 결과 트랜잭션이 사용한다. 경기 이력 API도 `MatchId` join으로 rated 여부를 만든다. | 현재 날짜의 row를 먼저 없애면 같은 상대에게 하루 한 번 제한이 풀릴 수 있다. 오래된 row는 현재 제한에는 쓰이지 않지만 이력의 rated 표시에는 쓰인다. |

`Players`에는 `TenantId`와 Entra `ObjectId`가 있고, `PvpMatches`에는 두 `PlayerId` 외래키가 있다. 경기 이력 응답은 `PlayerId`나 Entra ID를 내보내지 않지만, 내부 요약 행은 플레이어 계정과 연결된다. 표시 이름은 현재 `Players.DisplayName`을 조회하므로 과거 당시 이름의 snapshot은 보관하지 않는다.

### 실행 흐름과 제약

- match ticket은 발급 후 10분(`MATCH_TTL_MS`) 동안 유효하고 전투 시간 제한은 60초다. 결과 요청은 수신 시각이 만료 시각 이후면 410으로 처리한다. 발급된 경기 payload는 ticket이 만료되기 전까지 지우지 않아야 한다.
- 결과 제출은 저장된 양쪽 snapshot, seed, simulator/balance version, 입력을 사용해 서버에서 replay한다. completed/rejected 건의 동일·상이 payload 재요청도 현재 `InputJson`을 비교한다.
- `PvpRatedPairDays.MatchId`는 `PvpMatches.MatchId`를 참조하는 외래키이고 cascade delete가 정의되어 있지 않다. 연결 row가 있으면 부모 match를 먼저 물리 삭제할 수 없다. 두 플레이어 ID도 `Players` 외래키다.
- `PvpRatedPairDays`의 날짜별 pair primary key가 당일 제한을 보장한다. 과거 날짜 row는 현재 날짜의 matchmaking 조건과 일치하지 않지만 T05의 `rated` 표시는 계속 이 테이블에 의존한다.
- `InputJson` 요청 본문 상한은 1 MiB, 입력 이벤트 상한은 100,000개다. snapshot은 `nvarchar(max)`다. 이는 가능한 크기 경계이며 실제 경기 평균이나 운영 DB 크기를 뜻하지 않는다.
- 확인한 범위에는 경기 행·payload를 삭제하는 API, timer, scheduled cleanup이 없다. T06 화면은 이력만 제공하고 replay나 장기 통계는 제공하지 않는다.

## 보관 기간 선택지

각 기간은 terminal match를 기준으로 하는 예시다. `completed`와 `rejected`는 `CompletedAtUtc`, `expired`는 `ExpiresAtUtc`를 기준으로 삼을 수 있다. `issued` 행과 10분 ticket이 아직 유효한 데이터는 어떤 기간 선택에서도 보관해야 한다. 기간 선택과 실행 방식은 아직 승인되지 않았다.

| 기간 | 경기 요약 행 | `InputJson`·양쪽 snapshot | 운영 영향 |
| --- | --- | --- | --- |
| 30일 | 30일 이후 이력 화면에서 오래된 경기가 사라진다. | 비교적 적은 원본을 보관하지만, 한 달 이후 분쟁 확인·재생 검증이 어렵다. | 저장량을 가장 빠르게 줄이는 선택. 재시도 규칙과 pair-day 관계를 함께 설계해야 한다. |
| 90일 | 최근 3개월 경기 이력을 제공한다. | 약 3개월 동안 결과 재생과 비교를 지원한다. | 단기 지원 기간과 저장량 사이의 중간 선택. |
| 365일 | 연간 경기 이력을 제공한다. | 약 1년간 재생 자료를 남긴다. | 긴 분쟁 확인 기간을 주지만 원본 JSON 저장 부담이 커진다. |
| 무기한 | 경기 이력을 계속 보존한다. | 모든 경기의 재생 자료를 계속 보존한다. | 과거 분석을 최대한 유지하지만 저장량과 계정 연결 데이터를 계속 보유한다. |

요약 보관 기간과 payload 기간은 서로 다르게 선택할 수 있다. 예를 들어 **요약 365일 또는 무기한 + payload 90일**이면 사용자 이력은 유지하면서 큰 JSON 자료는 먼저 정리할 수 있다. `Rated` 상태도 계속 보여야 한다면 `PvpRatedPairDays`를 보존하거나 rated 여부를 요약 행에 별도 저장하는 schema 변경이 필요하다.

## 구현 방식 선택지와 영향

1. **요약과 payload 모두 유지**: 현 구조를 그대로 둔다. 가장 단순하며 재생·재시도 동작도 유지되지만 자동 정리와 용량 상한은 없다.
2. **요약 행은 유지하고 payload만 정리**: `Player1SnapshotJson`, `Player2SnapshotJson`을 nullable로 바꾸거나 payload를 별도 child table로 분리해야 한다. `InputJson`은 nullable이지만 기존 result service는 값이 있다고 가정하므로, payload 만료 후 completed/rejected 재시도 응답을 명시적으로 정의해야 한다. 이력 DTO에는 영향이 없도록 할 수 있다.
3. **기간이 지난 경기 행 전체 삭제**: 이력이 함께 사라진다. 연결된 `PvpRatedPairDays`를 먼저 처리해야 하며, 현재 UTC 날짜 pair 기록을 제거하면 rated 일일 제한이 깨질 수 있다. 삭제된 match의 재제출은 현재 410 대신 404가 되는 등 결과 API 동작도 달라질 수 있다.
4. **참여자 연결 익명화**: 현재 `PlayerId` 컬럼은 `NOT NULL`이고 `Players`와 `PvpRatedPairDays`에 외래키가 있다. 단순히 이름만 비우는 것으로 계정 연결이 사라지지 않으며, 이력 소유권·rated 판정·일일 제한을 바꾸는 별도 데이터 모델 설계가 필요하다.

## 권고안

- 완료된 경기의 **요약 행은 무기한 유지**하고, **입력·양쪽 snapshot은 terminal 상태가 된 뒤 90일 보관**하는 방안을 우선 검토한다. 이력 기능을 보존하면서 replay 원본의 기간을 제한할 수 있다.
- issued 상태는 만료 시각 이전에 정리하지 않는다. terminal 상태에서 보관 기산점을 적용할 때 운영 재시도 요구에 맞는 추가 유예 기간을 별도로 정한다.
- RatedPairDays는 현재의 같은 UTC 날짜 제한이 끝나기 전에는 삭제하지 않는다. 장기 요약의 rated 표시를 유지하도록 rated flag를 요약 행에 복사한 다음 과거 pair row를 정리할지, pair row를 함께 장기 보관할지 결정한다.
- payload 삭제 뒤에는 동일 경기 재제출을 replay하지 않고 기존 완료 결과나 명시된 만료 응답을 반환하도록 API를 수정한다. 별도 payload 테이블은 요약 보존과 원본 정리를 분리하기 쉽지만 추가 schema migration과 코드 변경이 필요하다.

이 권고는 선택을 돕기 위한 안이다. 이 문서 작성 중 SQL 행·payload를 읽거나 변경하지 않았고, migration·timer·cleanup 코드를 만들지 않았다.

## 사용자에게 필요한 결정

다음 네 항목을 선택해 주세요.

1. 경기 요약: 30일 / 90일 / 365일 / 무기한.
2. `InputJson`: 30일 / 90일 / 365일 / 무기한.
3. 양쪽 snapshot JSON: 30일 / 90일 / 365일 / 무기한.
4. 만료 payload를 정리할 때 요약 행을 유지할지, payload와 요약 행을 함께 삭제할지. 요약을 유지하면 `RatedPairDays`의 rated 표시를 어떻게 보존할지도 선택해야 한다.

선택 전에는 데이터 변경이나 cleanup 구현을 시작하지 않는다.
