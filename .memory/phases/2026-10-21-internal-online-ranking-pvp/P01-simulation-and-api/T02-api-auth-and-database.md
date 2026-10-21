# Task: T02 Functions API, Entra 검증, SQL 기반

## Status: done

## Goal
Node.js Azure Functions v4 API의 실행 기반을 만들고, 모든 보호 API에서 단일 Entra 테넌트 Bearer 토큰을 검증하며 관리 ID로 Azure SQL에 연결한다.

## Decision Summary
- API는 JavaScript ESM이며 Flex Consumption에서 실행한다. Static Web Apps Standard의 /api 경로가 연결된다.
- browser access token의 서명, issuer, audience, 만료, tenant를 확인한다. 사용자 식별은 tenantId + objectId다.
- SQL 비밀번호를 저장하지 않는다. Function App 관리 ID로 https://database.windows.net/.default 토큰을 받아 연결한다.

## Implementation

### I01. Functions 프로젝트와 인증 middleware
- Related Files:
  - api/host.json :: Functions host configuration — Functions v4, api routePrefix 유지; new.
  - api/package.json :: scripts and dependencies — @azure/functions v4, @azure/identity, jose, mssql; test는 node --test, check는 node --check src/index.js; new.
  - api/src/auth/entraBearer.js :: requireEntraUser — JWT 검증과 AuthContext 생성; new.
  - api/src/functions/me.js :: GET /api/me — 로그인 계정 확인 응답; new.
  - api/test/auth/entraBearer.test.js :: token claim cases — 인증 실패/성공; new.
- Details:
  - Signature: requireEntraUser(request: HttpRequest, config: { tenantId: string; apiAudience: string }): Promise<AuthContext>.
  - AuthContext: { tenantId: string; objectId: string; displayName: string | null }.
  - JWT issuer는 https://login.microsoftonline.com/{tenantId}/v2.0, audience는 apiAudience, tid는 설정 tenantId와 일치, oid는 필수, exp는 현재 서버 시간보다 이후여야 한다.
  - 서명 키는 Microsoft Entra OpenID metadata/JWKS에서 가져오고 캐시한다. 허용 서명 알고리즘은 RS256으로 고정한다.
  - 누락/잘못된 토큰은 401, 다른 tenant는 403, 설정 누락은 500을 반환하고 토큰 원문은 로그에 남기지 않는다.
  - GET /api/me는 { tenantId, objectId, displayName }만 반환한다. 토큰·claims 원본을 응답하지 않는다.
  - 환경 설정은 ENTRA_TENANT_ID, ENTRA_API_AUDIENCE다. 샘플 파일에는 값 설명만 쓰고 실제 tenant/client secret은 넣지 않는다.

### I02. SQL 연결과 초기 스키마
- Related Files:
  - api/src/database/sqlConnection.js :: getSqlPool — 관리 ID token 기반 연결; new.
  - api/migrations/001-initial-schema.sql :: core tables — 계정, 저장, stage, PvP 자료형; new.
  - api/src/database/transaction.js :: withTransaction — commit/rollback 보조 함수; new.
  - api/test/database/schema-contract.test.js :: schema contract — 컬럼·unique key 검사; new.
- Details:
  - Signature: getSqlPool(config: { server: string; database: string; credential: TokenCredential }): Promise<ConnectionPool>.
  - SQL server는 SQL_SERVER_FQDN, database는 SQL_DATABASE 설정을 사용한다. 인증은 Azure AD access token이고 로그인 비밀번호 설정은 금지한다.
  - Players: PlayerId uniqueidentifier PK, TenantId uniqueidentifier, ObjectId uniqueidentifier, DisplayName nvarchar(100) null, CreatedAtUtc datetime2, UpdatedAtUtc datetime2, UNIQUE(TenantId,ObjectId).
  - CloudSaves: PlayerId uniqueidentifier PK/FK, SchemaVersion int, Revision bigint, SaveJson nvarchar(max), UpdatedAtUtc datetime2.
  - StageRunTickets: RunId uniqueidentifier PK, PlayerId FK, Chapter int, Stage int, Seed bigint, SimulatorVersion int, BalanceVersion int, PlayerSnapshotJson nvarchar(max), IssuedAtUtc datetime2, ExpiresAtUtc datetime2, Status nvarchar(16), CompletedAtUtc datetime2 null.
  - StageBests: PlayerId PK/FK, Chapter int, Stage int, ClearTimeMs bigint, RunId FK, UpdatedAtUtc datetime2. 플레이어 한 명당 최고 진행 기록 한 행이다.
  - PlayerSnapshots: PlayerId PK/FK, Revision bigint, SnapshotJson nvarchar(max), UpdatedAtUtc datetime2.
  - PvpRatings: PlayerId PK/FK, Rating int NOT NULL DEFAULT 1000, UpdatedAtUtc datetime2.
  - PvpMatches: MatchId uniqueidentifier PK, Player1Id FK, Player2Id FK, Player1SnapshotRevision bigint, Player2SnapshotRevision bigint, Seed bigint, SimulatorVersion int, InputJson nvarchar(max) null, Outcome nvarchar(16) null, RatingBefore1 int, RatingBefore2 int, RatingAfter1 int null, RatingAfter2 int null, IssuedAtUtc datetime2, CompletedAtUtc datetime2 null, Status nvarchar(16).
  - PvpRatedPairDays: MatchDateUtc date, LowPlayerId uniqueidentifier, HighPlayerId uniqueidentifier, MatchId uniqueidentifier, PRIMARY KEY(MatchDateUtc,LowPlayerId,HighPlayerId). player ID를 정렬해 pair key를 계산한다.
  - migrations는 repeat-safe하지 않으므로 schema version table로 적용 여부를 관리한다. 사용자 데이터 삭제·초기화 명령은 제공하지 않는다.
  - Function managed identity에 DB connect 권한과 필요한 테이블별 DML 권한만 부여한다. 소유자 권한은 부여하지 않는다.

### I03. 독립 API 검증
- Related Files:
  - api/test/functions/me.test.js :: protected route cases — 인증·오류 응답; new.
- Details:
  - mock token provider와 mock SQL pool을 사용해 성공, 401, 403, issuer/audience/tenant mismatch를 검증한다.
  - 설정 값 누락과 SQL 연결 실패가 각각 500 및 안전한 오류 ID를 반환하는지 확인한다. connection token은 로그에 나타나지 않아야 한다.

## Acceptance Criteria
- [ ] API runtime이 Node 22 ESM Functions v4로 로컬 시작한다.
- [ ] tenant/audience/oid/서명/만료 검증이 실패 폐쇄 방식으로 동작한다.
- [ ] SQL 연결 코드에 username/password가 없고 managed identity 토큰만 사용한다.
- [ ] DDL이 plan의 모든 key/column type/index를 정의하며 계정별 unique key를 보장한다.

## Validation
    npm --prefix api test
    npm --prefix api run check

## Commit Message
    feat(api): add Entra protected Functions and SQL foundation

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P01-simulation-and-api
    Task: T02-api-auth-and-database

    - Validate single-tenant access tokens for protected routes
    - Add managed identity SQL access and versioned schema

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: pending
