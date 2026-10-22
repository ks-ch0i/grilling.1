# Phase: P01 공유 밸런스와 게임플레이

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T01 | `done` | v2 공통 밸런스 표와 재현 가능한 전투 목표 보정 | [T01](./T01-balance-rules-and-calibration.md) |
| T02 | `done` | 저장 v2 모델과 기존 로컬 저장 결정적 이행 | [T02](./T02-save-v2-and-legacy-migration.md) |
| T03 | `done` | 자유 포인트 배정, 레벨업 입력, 마을 초기화 | [T03](./T03-stat-points-and-town-reset.md) |
| T04 | `in_progress` | 강화 실패·파괴·대성공 판정과 확률 표시 | [T04](./T04-gear-upgrade-outcomes.md) |
| T05 | `pending` | 시드 적 수, 처치/클리어 골드, 재시도 보존 | [T05](./T05-stage-enemy-count-and-gold.md) |

## Progress
- done: 3/5 (active: T04)

## Dependencies
- T01 defines the v2 balance tables and deterministic stat/rounding rules consumed by T02-T05.
- T02 precedes all state-mutating gameplay tasks because every new player field must survive local save/load.
- T03-T05 are sequential because they touch shared progression and battle simulation modules.
