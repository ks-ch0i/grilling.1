# Current Context

## Active Plan
[캐릭터·장비 밸런스와 강화 실패·파괴](./plans/2026-10-22-character-gear-balance.md)

## Active Phase
[P01 공유 밸런스와 게임플레이](./phases/2026-10-22-character-gear-balance/P01-gameplay-and-save/phase.md)

## Active Task
[T05 시드 적 수, 골드 보상, 재시도 보존](./phases/2026-10-22-character-gear-balance/P01-gameplay-and-save/T05-stage-enemy-count-and-gold.md)

## Status
- 계획 생성: 2026-10-22. 기준 결정은 .memory/decisions/2026-10-22-character-gear-balance.md다.
- 새 계획은 P01 게임플레이/저장 5개 Task, P02 온라인 호환 3개 Task로 구성했다.
- P01-T01 공통 밸런스 규칙, P01-T02 저장 v2/기존 로컬 저장 이행, P01-T03 자유 포인트/초기화 구현은 비판적 리뷰 및 검증을 마쳤다.
- P01-T03 지정 테스트 41/41과 Node 22 빌드는 통과했다. 전체 테스트의 schema v1 API fixture 12건은 P02 T06-T07에서 v2 호환성을 구현할 때 갱신한다.
- P01-T03 비판적 리뷰에서 stage ticket simulatorVersion 검증이 아직 1인 통합 항목을 찾았다. P02-T07에서 rankedRunClient.js와 game-rules simulation의 stage ticket guard를 v2로 갱신하고, PvP의 별도 v1 guard는 유지한다.
- P01-T04 강화 실패/파괴/대성공을 구현하고 비판적 리뷰에서 발견한 최대 HP gear 파괴 후 HP 상한 초과 문제를 수정했다. 지정 테스트 15/15, Node 22 빌드 통과.
- 전체 테스트는 169개 중 157개 통과, 12개 실패다. 실패는 P02-T06~T07에서 다룰 cloud save/ranking snapshot/stage ticket의 schema v1 API fixture다.
- 다음 실행 항목은 P01-T05 시드 적 수, 골드 보상, 사망 재시도 보존이다.
- 이전 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 파일은 변경하지 않았다.

## Deferred Plan
- 이전 계획: [사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)
- 보류 위치: [P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md), [T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)
- T10 템플릿/workflow와 로컬 검증은 끝났고, target subscription/resource group을 정한 직접 배포 계획이 없으므로 what-if만 보류 상태다. P04 실제 배포도 보류하며 Azure 리소스는 만들지 않는다.
- 재개 조건: 구체적인 배포 계획과 대상 구독/리소스 그룹이 정해졌을 때 T10 what-if을 수행한다. 실제 Azure 배포는 별도 명시적 진행 지시와 비용 확인이 필요하다.

## Next Step (IMPORTANT)
P01-T05 청사진을 읽고 시드 기반 적 수, 처치/클리어 골드 보상, 사망 재시도 보존을 구현한다.
