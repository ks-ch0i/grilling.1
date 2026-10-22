# Phase: P02 온라인 버전 호환

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T06 | `done` | 클라우드 저장 v1 읽기 이행과 v2 쓰기 계약 | [T06](./T06-cloud-save-v2.md) |
| T07 | `done ✅` | 스테이지 랭킹 simulator/balance v2와 과거 기록 보존 | [T07](./T07-ranked-stage-v2.md) |
| T08 | `in_progress 🔵` | PvP snapshot/ticket v2와 구버전 스냅샷 매칭 차단 | [T08](./T08-pvp-v2-snapshots-and-matches.md) |

## Progress
- done: 2/3 (active: T08)

## Dependencies
- Start after P01. Shared migration and simulation contracts must exist before the API adopts schema and version 2.
- Keep completed v1 stage runs, PvP matches, and Elo rows unchanged. The API only issues and accepts current-version in-flight runs after rollout.
