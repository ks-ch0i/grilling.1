# Current Context

## Active Plan
[사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)

## Active Phase
[P01 공유 시뮬레이터와 API](./phases/2026-10-21-internal-online-ranking-pvp/P01-simulation-and-api/phase.md)

## Active Task
[T02 Functions 인증과 데이터베이스](./phases/2026-10-21-internal-online-ranking-pvp/P01-simulation-and-api/T02-api-auth-and-database.md)

## Status
- 계획 생성: 2026-10-21.
- T01 결정적 전투 시뮬레이터 구현과 검증을 완료했다. 다음은 Functions API, Entra 토큰 검증, SQL 스키마와 관리 ID 연결이다.
- 현재 저장 schemaVersion 1은 유지한다. 사용자 계정 저장·보상은 클라이언트 계산으로 남고 경쟁 기록만 서버 재생 검증한다.
- P01은 API까지, P02는 브라우저 연결, P03은 Azure template/workflow 준비, P04는 실제 사내 Azure 배포 및 E2E다.
- P04는 SQL 지속 비용, 리소스 그룹/위치, SignalR Free 수용 한도를 확인하고 사용자의 명시적 진행 지시가 있기 전까지 Azure 리소스를 만들지 않는다.
- SignalR Free 제약(동시 연결 20, 일일 메시지 20,000, Dev/Test only)을 P04 이전에 다시 확인한다.
- 기존 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 항목은 그대로 보존했다.

## Next Step (IMPORTANT)
T02 청사진을 읽고 Functions API 기반, Entra access token 검증, SQL schema 및 관리 ID 연결을 구현한다. 검증 명령은 T02에 기록되어 있다.
