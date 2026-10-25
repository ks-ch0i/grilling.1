# Phase: P02 서버 권위형 보상 API

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T03 | `done` | replay 결과에서 결정적 XP·골드·드롭·진행도 보상 결과를 계산한다. | [T03](./T03-deterministic-stage-rewards.md) |
| T04 | `done` | 서버 보상 프로필을 CloudSave와 분리해 저장하고 응답에 병합한다. | [T04](./T04-authoritative-profile-storage.md) |
| T05 | `done` | 인벤토리 전이와 골드/재료 차감을 revision·idempotency로 보호한다. | [T05](./T05-profile-economy-actions.md) |
| T06 | `done` | 검증된 run의 보상을 profile과 CloudSave에 원자적으로 적용한다. | [T06](./T06-atomic-stage-rewards.md) |

## Progress
- done: 4/4 (active: none)
