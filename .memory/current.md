# Current Context

## Active Plan
[사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)

## Active Phase
[P01 공유 시뮬레이터와 API](./phases/2026-10-21-internal-online-ranking-pvp/P01-simulation-and-api/phase.md)

## Active Task
[T04 스테이지 랭킹 API](./phases/2026-10-21-internal-online-ranking-pvp/P01-simulation-and-api/T04-stage-ranking-api.md)

## Status
- 계획 생성: 2026-10-21.
- T01 결정적 전투 시뮬레이터, T02 Functions 인증·SQL 기반, T03 계정별 클라우드 저장 API를 구현하고 검증했다. 다음은 스테이지 실행 티켓과 서버 재생 검증 랭킹이다.
- 현재 저장 schemaVersion 1은 유지한다. 사용자 계정 저장·보상은 클라이언트 계산으로 남고 경쟁 기록만 서버 재생 검증한다.
- P01은 API까지, P02는 브라우저 연결, P03은 Azure template/workflow 준비, P04는 실제 사내 Azure 배포 및 E2E다.
- P04는 SQL 지속 비용, 리소스 그룹/위치, SignalR Free 수용 한도를 확인하고 사용자의 명시적 진행 지시가 있기 전까지 Azure 리소스를 만들지 않는다.
- SignalR Free 제약(동시 연결 20, 일일 메시지 20,000, Dev/Test only)을 P04 이전에 다시 확인한다.
- 기존 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 항목은 그대로 보존했다.

## Next Step (IMPORTANT)
T04 청사진을 읽고 스테이지 실행 티켓과 서버 재생 검증 랭킹 API를 구현한다. 검증 명령은 T04에 기록되어 있다.
