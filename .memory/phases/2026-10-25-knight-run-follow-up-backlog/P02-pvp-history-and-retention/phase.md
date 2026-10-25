# Phase: P02 PvP 경기 이력과 상세 데이터 보관

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T05 | `done ✅` | 사용자 관점으로 정규화한 PvP 최근 경기 페이지 API 추가 (`M`) | [T05](./T05-pvp-history-api.md) |
| T06 | `done ✅` | 마을 PvP 기록 화면과 10경기 페이지 이동 추가 (`M`) | [T06](./T06-pvp-history-town-screen.md) |
| T07 | `done ✅` | 입력 로그·스냅샷 보관 기간과 정리 정책 결정안 작성 (`M`) | [T07](./T07-pvp-retention-policy.md) |

## Progress
- done: 3/3
- Dependency: T06은 T05의 응답 DTO를 사용한다. T07은 별도 읽기 전용 조사이며 데이터 삭제를 수행하지 않는다.
