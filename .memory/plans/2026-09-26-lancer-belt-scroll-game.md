# Plan: 마창기사 벨트스크롤 웹게임

## Goal

Phaser 4와 Vite 8을 사용하는 한국어 브라우저 게임을 새로 구성한다. 플레이어는 마을에서 장비를 관리하고 회차형 횡스크롤 전투에 출전한다. 접촉 전투, 레벨 성장, 무작위 장비 드롭·강화, 마을 복귀, 저장을 포함한 첫 플레이 가능한 버전을 완성한다.

완료 결과는 `npm run dev`로 실행할 수 있고, 데스크톱과 가로 화면 모바일에서 1회차 1-1부터 이후 회차까지 전투와 성장을 이어갈 수 있는 게임이다.

## Confirmed Constraints

- JavaScript + Phaser 4.2.1 + Vite 8.3.x; Node.js 22.12 이상.
- 모든 캐릭터와 장비는 단순 도형으로 표현한다. 이미지 에셋·오디오·온라인 서비스는 추가하지 않는다.
- 게임 규칙은 `.memory/decisions/2026-09-26-lancer-belt-scroll-game.md`의 확정 내용을 따른다.
- 저장소에 기존 게임 앱이나 프런트엔드 설정이 없다. 새 앱을 만들며, Git 저장소도 현재 초기화되어 있지 않다.

## Phases

| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `in_progress` | 빈 저장소에서 첫 플레이 가능한 게임까지 순차 구성 | [P01](../phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/phase.md) |

> 2026-10-20 상태 대조: 구현 커밋과 소스는 확인했지만 필요한 브라우저 시나리오를 실행할 수 없어 P01은 `done: 0/7`로 유지한다. 세부 근거와 미완료 조건은 P01 T01–T07에 기록했다.

## Task Order

| Task | Scope | Files |
| :--- | :--- | :--- |
| T01 | Vite/Phaser 프로젝트 뼈대 | `package.json`, `index.html`, `vite.config.js`, `src/main.js`, `src/styles.css`, `src/game/config.js`, `src/game/scenes/BootScene.js` |
| T02 | 밸런스 상수, 상태 스키마, 브라우저 저장소 | `src/game/data/balance.js`, `src/game/domain/models.js`, `src/game/domain/saveStore.js` |
| T03 | 장비 생성·착용·분해·강화 | `src/game/domain/gear.js`, `src/game/domain/stateFactory.js` |
| T04 | 전투 피해·치명타·경험치·스테이지 진행 | `src/game/domain/combat.js`, `src/game/domain/progression.js` |
| T05 | 마을과 장비/스테이지 관리 화면 | `src/game/scenes/TownScene.js`, `src/game/ui/components.js` |
| T06 | 횡스크롤 전투, 입력, 적·보스·드롭 | `src/game/scenes/BattleScene.js`, `src/game/ui/components.js` |
| T07 | 저장 연결, 사망/복귀/회차 전환 통합 | `src/main.js`, `src/game/scenes/BootScene.js`, `src/game/scenes/TownScene.js`, `src/game/scenes/BattleScene.js`, `src/game/domain/saveStore.js` |

## Implementation Defaults To Establish In Task Blueprints

결정 문서는 성장 규칙과 장비 역할을 정했지만, 모든 기준 수치와 고유 효과의 카탈로그는 정하지 않았다. 첫 버전의 변경하기 쉬운 기본값으로 다음을 사용한다.

- 커먼 장비 부위 기준값: 투구 방어력 +4, 갑옷 방어력 +8·최대 HP +20, 장갑 치명타 확률 +0.03·치명타 배율 +0.15, 신발 치명타 확률 +0.02·치명타 배율 +0.25, 창 공격력 +8, 말 이동 속도 +20%.
- 플레이어 기본 이동 속도 200 world-pixels/second. 장비 이동 속도 배율을 적용한 뒤 위치를 갱신한다.
- 일반 적 기본값(1회차 1스테이지): HP 60, 공격력 12, 방어력 10. 보스는 결정된 5x/2x/2x 배율을 사용한다.
- 첫 버전 고유 효과 카탈로그: `bonusDamage`, `lifeSteal`, `damageReduction`, `thorns`. 장비 한 개 안에서는 효과 ID 중복을 허용하지 않는다. 각 효과의 값은 등급별 표로 balance 상수에 둔다.
- 스테이지마다 10마리를 같은 간격 범위 안에서 무작위 배치한다. 최초 생성한 위치는 전투 도중 바꾸지 않는다.
- 회차마다 드롭 확률 표는 해당 회차의 1~10스테이지 인덱스를 기준으로 보간한다.
- 화면 새로고침 중에는 진행 중 전투 위치를 저장하지 않는다. 저장된 캐릭터/보상 상태를 유지하고 현재 스테이지는 처음부터 재시작한다. 전투 중 죽었을 때도 XP와 그 XP로 이미 확정된 레벨업은 유지하고, 장비·재료·드롭은 스테이지 입장 시점으로 복구한다.

이 값들은 유저가 별도 수치를 지정하지 않은 영역의 첫 플레이 가능한 기본값이다. 모두 `balance.js` 한 곳에서 조정할 수 있게 한다.

## Technical References

- [Phaser 4.2.1 release](https://phaser.io/download/phaser4)
- [Phaser scenes](https://docs.phaser.io/phaser/concepts/scenes)
- [Phaser camera](https://docs.phaser.io/phaser/concepts/cameras)
- [Phaser input](https://docs.phaser.io/phaser/concepts/input)
- [Vite releases](https://vite.dev/releases)
- [Vite getting started](https://vite.dev/guide/)
