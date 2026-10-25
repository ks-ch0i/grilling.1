# Current Context

## Active Plan
[마창기사 저장 권위 전환 및 PvP 상세 데이터 보관](./plans/2026-10-25-knight-run-save-authority-and-pvp-retention.md)

## Active Phase
[P03 client save boundary](./phases/2026-10-25-knight-run-save-authority-and-pvp-retention/P03-client-save-boundary/phase.md)

## Active Task
[T08 gameplay reward integration](./phases/2026-10-25-knight-run-save-authority-and-pvp-retention/P03-client-save-boundary/T08-gameplay-reward-integration.md)

## Status
- P03-T07 complete: account-scoped verified backups and unverified shadows are separated; guest/offline recovery is explicit, reconnect is read-only, and ranked ticket fallback uses the local shadow. Focused tests: 81 passed; root suite: 186 passed; Vite build passed.
- 2026-10-25 후속 작업 계획을 만들었다. 4개 Phase, 9개 독립 Task가 있으며 빠른 품질·조작 개선부터 시작한다.
- 저장 무결성과 PvP 원본 데이터 보관 Task는 읽기 전용 조사·결정안까지만 한다. 데이터 삭제나 서버 권위형 저장 변경은 별도 결정 전까지 하지 않는다.
- P01-T01 테스트 자동화 완료: 루트 게임 테스트 128개, API 테스트 88개, Vite 빌드 및 workflow YAML 구문 검증 통과.
- P01-T02 보관함 터치 스크롤 완료: 8개 focused interaction tests, 전체 루트 테스트 136개, Vite build 통과. 브라우저 수동 확인은 로컬 브라우저 surface를 사용할 수 없어 미실행.
- P01-T03 마을 키보드 탐색 완료: 5개 focused tests, 전체 루트 테스트 141개, Vite build 통과. 브라우저 수동 확인은 사용 가능한 브라우저 surface가 없어 미실행.
- P01 품질과 조작 완료: 4/4 task. P01-T04 전체 루트 테스트 144개, startup tests 3개, production build 통과. 브라우저 network panel 수동 확인은 브라우저 surface 부재로 미실행.
- P02-T05 인증된 PvP 경기 이력 API 완료: API 전체 테스트 98개, focused tests 22개, Function entry check 통과. Commit `b3eb24b`.
- P02-T06 마을 PvP 경기 기록 overlay 완료: 루트 테스트 157개, focused tests 23개, Vite build 통과. 브라우저 surface 부재로 수동 QA는 미실행. Commit `e0e88e0`.
- P02-T07 PvP 데이터 보관 구조·선택지 결정안 완료: schema/repository/service 정적 대조. 운영 데이터 변경이나 cleanup은 수행하지 않음. Commit `71b7193`.
- P03-T08 생성 기사 스프라이트 적용 완료: 20-frame transparent sheet, manifest, normal/ranked visuals. 루트 161 tests와 build 통과. Browser manual QA는 미실행. Commit `adf9c9d`.
- P04-T09 저장 신뢰 경계 평가 완료: client-owned 저장의 구조 검증과 gameplay provenance를 구분하고, 세 권위 모델 및 단계별 권고안을 작성. 코드·스키마·저장 데이터·Azure 변경 없음. Commit `6cc4343`.
- 이전 계획의 4개 Phase, 9개 Task 전체 완료. PvP 보관과 저장 권위 변경은 새 선택이 필요해 별도 후속 계획으로 넘겼고, 현재는 그 선택을 반영한 구현 계획을 시작한다.
- 후속 구현 계획 확정: PvP 경기 요약은 무기한 보관하고 입력·전투 스냅샷은 terminal 시점부터 90일 보관한다. 온라인 검증 보상·진행도는 서버 권위로 전환하며, 오프라인 진행도와 기존 v2 보상값은 복구 가능한 미검증 로컬 데이터로 유지한다.
- 현재 계획은 3개 도메인 Phase와 8개 Task로 구성한다. 이번 계획에서 코드·DB·저장 데이터·Azure 자원은 변경하지 않았다.

- P01-T01 complete: PvP summaries and replay payloads are separated; missing terminal payloads return 410. Focused tests: 25 passed; API suite: 104 passed.

- P01-T02 complete: added daily bounded PvP payload and old pair-day cleanup. Focused cleanup tests: 12 passed; API suite: 116 passed; Function entry check passed.

- P02-T03 complete: shared rules now calculate deterministic XP, gold, collected drops, level progression and clear unlocks. Focused tests: 34 passed; root suite: 173 passed; Vite build passed with a Phaser chunk-size warning.
- P02-T04 complete: separated canonical rewards/progression into PlayerRewardProfiles, archived legacy save bytes and added identity-scoped unverified recovery. API suite: 123 passed; Function entry check passed. No migration was applied to an environment.
- P02-T05 complete: added revision-bound, idempotent server commands for equip, dismantle, gold and material spending. Focused API tests: 17 passed; API suite: 141 passed; root suite: 178 passed; API check and Vite build passed. No database migration was applied.
- P02-T06 complete: stage replay rewards and ticket results commit atomically; clear/death responses install the latest canonical state. Focused API stage/schema tests: 32 passed; client/coordinator tests: 45 passed; API suite: 147 passed; root suite: 180 passed; API check and Vite build passed. No database migration was applied.

## Deferred Plan
- 이전 계획: [사내 온라인 랭킹 및 비동기 PvP](./plans/2026-10-21-internal-online-ranking-pvp.md)
- 보류 위치: [P03 Azure 인프라 코드](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/phase.md), [T10 Azure 인프라 구성](./phases/2026-10-21-internal-online-ranking-pvp/P03-azure-infrastructure/T10-azure-infrastructure.md)
- 대상 구독·리소스 그룹이 정해지지 않아 what-if와 실제 배포가 보류 상태다. 이번 계획에서도 Azure 리소스 생성·배포·실환경 검증은 제외한다.

## Next Step
Read the active T08 blueprint and connect Battle/Town reward and profile action flows to verified server responses.
