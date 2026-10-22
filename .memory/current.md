# Current Context

## Active Plan
[캐릭터·장비 밸런스와 강화 실패·파괴](./plans/2026-10-22-character-gear-balance.md)

## Active Phase
완료

## Active Task
없음 — 캐릭터·장비 밸런스 계획의 P01/P02 작업 완료

## Status
- 계획 생성: 2026-10-22. 기준 결정은 .memory/decisions/2026-10-22-character-gear-balance.md다.
- 새 계획은 P01 게임플레이/저장 5개 Task, P02 온라인 호환 3개 Task로 구성했다.
- P01-T01~T05 공유 밸런스, 저장 v2, 자유 포인트/초기화, 강화 결과, 적 수/골드 작업은 비판적 리뷰 및 지정 검증을 마쳤다.
- P01-T03 지정 테스트 41/41, P01-T04 지정 테스트 15/15, P01-T05 지정 테스트 28/28 및 Node 22 빌드는 통과했다.
- P01-T03 비판적 리뷰에서 stage ticket simulatorVersion 검증이 아직 1인 통합 항목을 찾았다. P02-T07에서 rankedRunClient.js와 game-rules simulation의 stage ticket guard를 v2로 갱신하고, PvP의 별도 v1 guard는 유지한다.
- P01-T04 강화 실패/파괴/대성공을 구현하고 비판적 리뷰에서 발견한 최대 HP gear 파괴 후 HP 상한 초과 문제를 수정했다. 지정 테스트 15/15, Node 22 빌드 통과.
- P01-T05 리뷰에서 상호 처치 골드 누락, overflow 복구 경로, Scene 재시작 상태와 적 수 재추첨을 찾아 수정했다. 골드 복구는 사용자가 정확한 차감량 또는 0 초기화를 확인해야 한다.
- P02-T06 클라우드 저장 호환을 완료했다. API는 v1 row를 공유 migration으로 v2 envelope로 읽고 원본 revision/timestamp를 보존하며, API/브라우저 쓰기는 v2만 허용한다. 비판적 리뷰에서 지적한 패키지 import와 클라이언트 state version 검사를 수정했다.
- P02-T06 Node.js 22.12.0 API 회귀 69/69, browser client 7/7 및 Vite production build 통과. build에는 기존 500 kB chunk 경고가 남아 있다.
- P02-T07 스테이지 랭킹 v2를 완료했다. 새 발급·재생은 simulatorVersion/balanceVersion 2를 사용하고, 제출 중이거나 새 ticket을 막는 v1 티켓은 만료 처리하며 완료된 v1 최고 기록은 그대로 조회한다. 능력치 배분 0/1/2개와 API 정규화 후 재생 일치도 검증했다.
- P02-T07 비판적 리뷰에서 오래된 진행 티켓이 새 v2 런을 30분간 막는 문제를 발견해 서버 발급/제출 경로와 클라이언트 대기 티켓 정리를 수정했다. 전체 루트 및 API 테스트, Vite production build가 통과했다. 빌드에는 500 kB 초과 chunk 경고가 남아 있다.
- P02-T08 PvP snapshot/ticket v2와 구버전 스냅샷 매칭 차단을 완료했다. 기존 행은 migration에서 v1로 보존하고, 신규 스냅샷·매치·재생은 v2로 제한했다. 오래된 진행 중 매치는 Elo 갱신 없이 거절한다. T08 지정 테스트 60/60, 전체 루트/API 테스트, Vite production build가 통과했고 비판적 리뷰에서 추가 지적은 없었다. 빌드에는 기존 500 kB 초과 chunk 경고가 남아 있다.
- 캐릭터·장비 밸런스 계획의 P01/P02 전체 8개 Task가 완료됐다. Azure 배포 계획 부재로 별도 사내 온라인 랭킹/PvP 계획의 P03 what-if와 P04 배포는 계속 보류한다.
- 이전 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 파일은 변경하지 않았다.

## Deferred Plan
- 이전 계획: [사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)
- 보류 위치: [P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md), [T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)
- T10 템플릿/workflow와 로컬 검증은 끝났고, target subscription/resource group을 정한 직접 배포 계획이 없으므로 what-if만 보류 상태다. P04 실제 배포도 보류하며 Azure 리소스는 만들지 않는다.
- 재개 조건: 구체적인 배포 계획과 대상 구독/리소스 그룹이 정해졌을 때 T10 what-if을 수행한다. 실제 Azure 배포는 별도 명시적 진행 지시와 비용 확인이 필요하다.

## Next Step
이 계획에는 남은 활성 Task가 없다. 새 지시 전까지 별도 보류 계획의 Azure what-if/배포는 시작하지 않는다.
