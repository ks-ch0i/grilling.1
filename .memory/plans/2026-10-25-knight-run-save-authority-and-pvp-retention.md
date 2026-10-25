# Plan: 마창기사 저장 권위 전환 및 PvP 상세 데이터 보관

## Goal
검증된 온라인 스테이지 결과만 XP·레벨·골드·재료·보상 아이템·스테이지 진행도에 반영하고, 오프라인 진행은 별도 미검증 로컬 저장으로 보존한다. PvP 경기 요약은 계속 조회할 수 있게 유지하고, 재생 입력과 전투 스냅샷은 경기 종료 후 90일이 지나면 정리한다.

## Status: complete

## Confirmed Decisions
- 저장 권위는 모델 2로 전환한다. 첫 서버 권위 필드는 XP/레벨, 골드/재료, 스테이지 보상 아이템/인벤토리, 클리어·해금 진행도다.
- 오프라인 보상은 서버 확인 전까지 미검증 로컬 진행으로 남긴다. 로컬 게스트 세션도 같은 미검증 경계 안에 둔다.
- 기존 v2 저장의 전체 원본을 복구용으로 보존하되, 그 안의 XP·재화·인벤토리·진행도를 새 서버 검증 프로필로 자동 승격하지 않는다.
- PvP 요약 행은 무기한 보관한다. 입력 로그와 양측 전투 스냅샷은 terminal 시점에서 90일 보관한다. 발급 중인 match는 만료 전 정리하지 않는다.
- PvpRatedPairDays는 오늘 UTC 날짜의 일일 rated 제한에만 필요하다. 경기 요약의 rated 표시를 별도 필드로 보존한 뒤 지난 UTC 날짜의 pair row를 정리한다.
- 장비 능력치/강화 결과, 능력치 배정, PvP·랭킹 snapshot의 전체 신뢰 모델은 이번 계획에서 서버 권위로 옮기지 않는다. 클라이언트 소유 필드의 위변조 위험은 남는다.
- 계획 대상은 코드와 DB migration이다. Azure 배포, 운영 데이터 migration 실행, 운영 timer 활성화는 제외한다.

## Phases
| Phase | Status | Summary | Blueprint |
| :--- | :--- | :--- | :--- |
| P01 | `done` | PvP 요약과 90일 전투 페이로드를 분리하고 정리 timer를 추가한다. | [P01](../phases/2026-10-25-knight-run-save-authority-and-pvp-retention/P01-pvp-retention/phase.md) |
| P02 | `done` | 결정적 보상 계산, 서버 프로필, 비용이 있는 프로필 명령과 원자적 스테이지 지급을 구현한다. | [P02](../phases/2026-10-25-knight-run-save-authority-and-pvp-retention/P02-authoritative-rewards-api/phase.md) |
| P03 | `done` | 계정별 검증 저장과 로컬 shadow를 분리하고 전투·마을 화면을 결과 계약에 연결한다. | [P03](../phases/2026-10-25-knight-run-save-authority-and-pvp-retention/P03-client-save-boundary/phase.md) |

## Ordering and Dependencies
- P01-T01 schema/API 호환 작업이 P01-T02 cleanup timer보다 먼저다. cleanup은 새 child payload table과 요약 `Rated` 필드를 전제로 한다.
- P02-T03은 순수 game-rules 계약과 전투 replay 결과를 확정한다. P02-T06 서버 지급은 이 결과만 신뢰한다.
- P02-T04 프로필 저장/CloudSave 병합이 P02-T05 재화·인벤토리 명령과 P02-T06 스테이지 지급의 공통 기반이다.
- P03은 서버 API와 결과 DTO가 고정된 뒤 시작한다. 기존 account generation, CAS revision, recovery backup, guest-local 동작을 함께 검증한다.
- 매 작업의 테스트와 빌드는 해당 Task 파일에 기록한다. 이 계획 수립 중에는 테스트를 실행하지 않았다.

## Out of Scope
- 모델 3 전체 전환: 장비 강화 결과, 장착 장비 snapshot, base stat과 능력치 배정을 서버 명령으로 완전히 검증하는 일.
- PvP 입력/전투 replay 화면, 전투 요약 보관 기간 변경, 계정 삭제/익명화 정책.
- Azure 리소스 생성·배포, 운영 DB migration 실행, 운영 timer 동작 확인.
- 로컬 게스트 기능 자체의 제품 정책 변경.

## Regression Traps
- CloudSave CAS는 동시 저장 충돌을 막지만 게임 보상 출처를 증명하지 않는다. API가 클라이언트가 보내는 서버 소유 필드를 merge 대상으로 삼으면 안 된다.
- 기존 v2 보상 필드는 유효한 JSON이어도 출처를 증명할 수 없다. 이 값을 canonical profile에 복사하면 전환 직후부터 위조된 보상을 신뢰하게 된다.
- stage ticket 완료와 프로필 지급은 한 SQL transaction이어야 한다. result 재시도가 같은 RunId 보상을 두 번 적용하지 않도록 결과/보상 JSON을 함께 보관한다.
- PvP history의 rated 값은 과거 pair-day row 정리 뒤에도 같아야 한다. issued match의 입력 또는 snapshot을 만료 시각 전에 삭제하면 replay가 불가능하다.
- 오프라인 save의 전체 JSON을 online PUT으로 재전송하면 서버 canonical 필드를 덮거나 미검증 보상을 승격시킬 수 있다.
- 모델 2에서는 baseStats·장비 stats가 계속 클라이언트 소유다. 온라인 랭킹/PvP snapshot을 해당 필드까지 안전하다고 표현하지 않는다.
