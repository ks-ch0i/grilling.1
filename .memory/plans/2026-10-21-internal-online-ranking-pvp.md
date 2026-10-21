# Plan: 사내 온라인 랭킹 및 비동기 PvP

## Goal
회사 Entra 계정으로 로그인하는 내부 온라인 게임을 위해 계정별 클라우드 저장, 서버 검증 스테이지 랭킹, 스냅샷 기반 비동기 PvP, 상단 랭킹 전광판을 구현하고 전용 Azure 리소스에 배포할 준비를 한다.

## Confirmed Architecture
- Frontend: 현재 Phaser/Vite 브라우저 게임, MSAL Browser로 단일 Entra 테넌트 인증.
- API: JavaScript Azure Functions Flex Consumption, Static Web Apps Standard의 Bring Your Own Functions API 연결.
- Data: 전용 Azure SQL Database General Purpose Provisioned compute. Functions 관리 ID로 SQL에 접속.
- Realtime: 전용 Azure SignalR Free, 서버 이벤트와 60초 polling 복구.
- Azure 리소스는 기존 유사 리소스를 재사용하지 않는다. 위치는 계획 기본값 East Asia이며 리소스 생성 전에 사용자 환경에서 확인한다.
- 스테이지 점수와 PvP 결과는 공용 60Hz 결정적 시뮬레이터로 재생 검증한다. 클라우드 저장 진행·보상 자체는 서버 권위형으로 바꾸지 않는다.
- 오프라인 스테이지 진행은 저장 동기화만 허용하고 경쟁 점수는 제외한다. PvP는 온라인 전용이다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `done` | 공유 전투 시뮬레이터와 계정·저장·랭킹·PvP API 구현 | [P01](../phases/2026-10-21-internal-online-ranking-pvp/P01-simulation-and-api/phase.md) |
| P02 | `in_progress` | 브라우저 로그인, 저장 동기화, 랭킹 전투, PvP, 전광판 연결 | [P02](../phases/2026-10-21-internal-online-ranking-pvp/P02-browser-integration/phase.md) |
| P03 | `pending` | 전용 Azure 구성 코드와 배포 설정 준비 | [P03](../phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md) |
| P04 | `pending` | 비용 재확인 후 사내 구독 배포 및 실환경 검증 | [P04](../phases/2026-10-21-internal-online-ranking-pvp/P04-internal-rollout/phase.md) |

## Key Contracts
- Entra 계정 키: tenant ID + object ID. 클라이언트 저장 키는 계정별로 분리한다.
- Cloud save DTO: schemaVersion 1 게임 상태, server revision, server updatedAtUtc.
- Battle input event: monotonically increasing tick, event kind, value. 이동 방향은 -1/0/1, 레벨업 선택은 attack/defense/maxHp.
- Stage run ticket: runId, playerId, chapter, stage, server seed, simulatorVersion, balanceVersion, server startedAtUtc, expiresAtUtc, immutable player stat/effect snapshot.
- Stage result: 입력 이벤트를 서버에서 재생한 성공 여부와 서버 측 elapsedMs. 클라이언트가 보낸 승패·시간·레이팅 값은 신뢰하지 않는다.
- PvP ticket: matchId, seed, simulatorVersion, 양쪽 player ID와 snapshot revision, 서버 시작 시각. 상대는 고정 위치의 스냅샷 타깃이며 별도 이동 AI는 없다.
- Elo: 기본 1000, K=32, 한 SQL 트랜잭션에서 양쪽 점수 변경. 동일 unordered player pair는 UTC 날짜당 최대 한 번만 rated 처리.

## Security and Cost Gates
- 모든 API는 Bearer access token의 서명, issuer, audience, 만료, tenant를 확인하고 object ID로 계정을 식별한다.
- SQL은 브라우저에 직접 노출하지 않으며 Azure Functions 관리 ID로만 접근한다. 저장 값은 클라이언트가 조작할 수 있다는 위험을 결정 문서에 명시했다.
- SignalR Free는 20 동시 연결과 20,000 메시지/일 제한을 운영 대시보드와 수용 기준에 반영한다.
- Provisioned SQL vCore 수, resource group, 실제 위치, SignalR Free 수용 여부, 월 비용을 P04 전에 확인한다. P04의 Azure 배포는 비용 확인과 명시적 진행 지시가 있기 전에는 실행하지 않는다.

## Out of Scope
- 경험치·장비·재료를 서버 권위형으로 이관하거나 로컬 저장 값의 진위를 검증하는 일.
- 시즌 운영, 실시간 동시 플레이 PvP, 상대 추격 이동 AI, 기존 Azure 리소스 재사용.
- 이번 계획 작성 중 코드 구현, 리소스 생성, 실제 배포.
