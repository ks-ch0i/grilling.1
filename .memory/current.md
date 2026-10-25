# Current Context

## Active Plan
[마창기사 UX·PvP 기록 및 안정성 개선](./plans/2026-10-25-knight-run-follow-up-backlog.md)

## Active Phase
[P03 전투 시각 요소](./phases/2026-10-25-knight-run-follow-up-backlog/P03-combat-visuals/phase.md)

## Active Task
[T08 애니메이션 기사 스프라이트](./phases/2026-10-25-knight-run-follow-up-backlog/P03-combat-visuals/T08-animated-knight-sprite.md)

## Status
- 2026-10-25 후속 작업 계획을 만들었다. 4개 Phase, 9개 독립 Task가 있으며 빠른 품질·조작 개선부터 시작한다.
- 저장 무결성과 PvP 원본 데이터 보관 Task는 읽기 전용 조사·결정안까지만 한다. 데이터 삭제나 서버 권위형 저장 변경은 별도 결정 전까지 하지 않는다.
- P01-T01 테스트 자동화 완료: 루트 게임 테스트 128개, API 테스트 88개, Vite 빌드 및 workflow YAML 구문 검증 통과.
- P01-T02 보관함 터치 스크롤 완료: 8개 focused interaction tests, 전체 루트 테스트 136개, Vite build 통과. 브라우저 수동 확인은 로컬 브라우저 surface를 사용할 수 없어 미실행.
- P01-T03 마을 키보드 탐색 완료: 5개 focused tests, 전체 루트 테스트 141개, Vite build 통과. 브라우저 수동 확인은 사용 가능한 브라우저 surface가 없어 미실행.
- P01 품질과 조작 완료: 4/4 task. P01-T04 전체 루트 테스트 144개, startup tests 3개, production build 통과. 브라우저 network panel 수동 확인은 브라우저 surface 부재로 미실행.
- P02-T05 인증된 PvP 경기 이력 API 완료: API 전체 테스트 98개, focused tests 22개, Function entry check 통과. Commit `b3eb24b`.
- P02-T06 마을 PvP 경기 기록 overlay 완료: 루트 테스트 157개, focused tests 23개, Vite build 통과. 브라우저 surface 부재로 수동 QA는 미실행. Commit `e0e88e0`.
- P02-T07 PvP 데이터 보관 구조·선택지 결정안 완료: schema/repository/service 정적 대조. 운영 데이터 변경이나 cleanup은 수행하지 않음. Commit `71b7193`.

## Deferred Plan
- 이전 계획: [사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)
- 보류 위치: [P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md), [T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)
- 대상 구독·리소스 그룹이 정해지지 않아 what-if와 실제 배포가 보류 상태다. 이번 계획에서도 Azure 리소스 생성·배포·실환경 검증은 제외한다.

## Next Step
T08 청사진을 읽고 투명 배경 기사 애니메이션 시범 asset을 생성해 전투 화면에 연결한다.
