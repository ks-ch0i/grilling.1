# Phase: P01 품질 자동화와 가로 화면 조작

## Tasks
| Task | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| T01 | `done` | 루트 테스트 명령과 배포 없는 CI 검증 추가 (`S`) | [T01](./T01-test-automation.md) |
| T02 | `in_progress` | 마을 보관함의 가로 터치 스크롤 추가 (`S`) | [T02](./T02-town-touch-scroll.md) |
| T03 | `pending` | 마을 주요 UI의 키보드 포커스·실행 지원 (`M`) | [T03](./T03-town-keyboard-navigation.md) |
| T04 | `pending` | 인증 후 Phaser 게임 코드를 비동기 로드해 초기 진입 번들 분리 (`M`) | [T04](./T04-defer-game-runtime.md) |

## Progress
- done: 1/4 (active: T02)
- Dependency: T01 검증 자동화가 먼저 준비되면 T02–T04를 각각 독립적으로 검증한다.
