# Current Context

## Active Plan
[캐릭터·장비 밸런스와 강화 실패·파괴](./plans/2026-10-22-character-gear-balance.md)

## Active Phase
[P01 공유 밸런스와 게임플레이](./phases/2026-10-22-character-gear-balance/P01-gameplay-and-save/phase.md)

## Active Task
[T02 저장 v2 모델과 기존 로컬 저장 결정적 이행](./phases/2026-10-22-character-gear-balance/P01-gameplay-and-save/T02-save-v2-and-legacy-migration.md)

## Status
- 계획 생성: 2026-10-22. 기준 결정은 .memory/decisions/2026-10-22-character-gear-balance.md다.
- 새 계획은 P01 게임플레이/저장 5개 Task, P02 온라인 호환 3개 Task로 구성했다.
- P01-T01 공통 밸런스 규칙은 구현·검증을 마쳤다. 1,024개 고정 seed 표본에서 C1S1과 C1S10 모두 전투를 완주했다.
- 다음 실행 항목은 P01-T02 저장 v2 모델과 기존 로컬 저장 결정적 이행이다.
- 이전 작업공간의 .agents/, .codeburn/, AGENTS.md, CODEBURN-SETUP.md, README.md, examples/ 미추적 파일은 변경하지 않았다.

## Deferred Plan
- 이전 계획: [사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)
- 보류 위치: [P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md), [T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)
- T10 템플릿/workflow와 로컬 검증은 끝났고, target subscription/resource group을 정한 직접 배포 계획이 없으므로 what-if만 보류 상태다. P04 실제 배포도 보류하며 Azure 리소스는 만들지 않는다.
- 재개 조건: 구체적인 배포 계획과 대상 구독/리소스 그룹이 정해졌을 때 T10 what-if을 수행한다. 실제 Azure 배포는 별도 명시적 진행 지시와 비용 확인이 필요하다.

## Next Step (IMPORTANT)
P01-T02 청사진을 읽고 저장 스키마와 기존 저장 이행 경로를 검토한 뒤 결정적 migration을 구현한다.
