# Current Context

## Active Plan
[사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)

## Active Phase
[P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md)

## Active Task
[T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)

## Status
- 계획 생성: 2026-10-21.
- P01 완료: 공유 결정적 시뮬레이터, Functions 인증·SQL 기반, 클라우드 저장, 스테이지 검증 랭킹, 공개 스냅샷과 비동기 PvP Elo API를 구현하고 검증했다. P02 T06 Entra 계정 로그인/계정별 저장, T07 60Hz 티켓 기반 스테이지 전투/검증 제출, T08 PvP 스냅샷 매칭/서버 판정 전투, T09 SignalR 전광판/폴링 복구를 구현하고 검증했다.
- 현재 저장 schemaVersion 1은 유지한다. 사용자 계정 저장·보상은 클라이언트 계산으로 남고 경쟁 기록만 서버 재생 검증한다.
- P01은 API까지, P02는 브라우저 연결, P03은 Azure template/workflow 준비, P04는 실제 사내 Azure 배포 및 E2E다.
- P04는 SQL 지속 비용, 리소스 그룹/위치, SignalR Free 수용 한도를 확인하고 사용자의 명시적 진행 지시가 있기 전까지 Azure 리소스를 만들지 않는다.
- SignalR Free 제약(동시 연결 20, 일일 메시지 20,000, Dev/Test only)을 P04 이전에 다시 확인한다.
- T10 템플릿·배포 설정과 로컬 검증은 완료했으며, 승인된 구독/리소스 그룹 및 실제 Entra 입력으로 read-only what-if가 남아 있다.
- 기존 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 항목은 그대로 보존했다.

## Next Step (IMPORTANT)
T10의 read-only what-if를 승인된 구독/리소스 그룹과 실제 Entra 입력으로 수행한다. 실제 리소스 생성과 Azure 배포는 P04의 비용 확인 및 사용자의 명시적 진행 지시 전까지 수행하지 않는다.
