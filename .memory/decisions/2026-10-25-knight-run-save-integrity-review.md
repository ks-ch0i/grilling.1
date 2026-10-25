# 저장 데이터 신뢰 경계와 서버 권위 전환 검토

- Date: 2026-10-25
- Status: Review complete; model and field ownership require user decision
- Scope: 정적 코드 조사와 아키텍처 선택지 비교
- Production code, schema, user saves, Azure resources and deployed services were not changed.

## 요약

현재 클라이언트 저장은 **형식과 값 범위를 검사**하지만, 저장된 골드·장비·레벨·진행도가 정상 플레이로 만들어졌는지는 증명하지 못한다. CloudSaves의 revision 비교는 동시 저장 충돌을 막는 장치이며, 게임 보상의 출처를 검증하는 장치는 아니다.

랭킹 스테이지와 PvP 결과는 서버가 고정된 전투 입력을 재생해 기록과 승패를 계산한다. 그러나 스테이지의 XP·골드·장비·진행도 변경은 별도로 브라우저에서 처리하고 CloudSaves에 업로드한다. 따라서 검증된 랭킹 기록이 검증된 게임 프로필을 의미하지 않는다. PvP Elo는 서버가 계산하지만 현재 PvP는 골드나 장비 같은 게임 보상을 지급하지 않는다.

권고 방향은 **모델 2를 1단계 목표로 삼는 점진 전환**이다. 우선 온라인 스테이지 보상과 진행도, PvP/랭킹용 프로필 스냅샷의 자격을 서버에서 통제하고, 이후 장비·재료 경제를 필요에 따라 서버 명령으로 옮긴다. 기존 v2 저장은 읽기 전용 원본으로 보존하고, 가져온 값의 출처를 확인할 수 없는 점을 이행 정책에 반영해야 한다.

## 현재 신뢰 경계

| 데이터 | 현재 작성자·저장소 | 현재 검증 | 서버가 독립적으로 계산할 수 있는 것 | 남는 신뢰 문제 |
| --- | --- | --- | --- | --- |
| 레벨, XP, 다음 레벨 XP, 대기 레벨업, HP | 게임 클라이언트가 localStorage에서 갱신하고 CloudSaves에 전체 상태 저장 | v2 구조와 숫자 범위 검사 | 티켓을 사용한 스테이지 전투 결과와 일부 전투 스냅샷 | CloudSave PUT 자체는 XP/레벨업 이력을 요구하지 않음 |
| 기본 능력치, 배정·잔여 포인트, 초기화 횟수 | 캐릭터 레벨업·초기화 UI와 게임 규칙 | 정수·키·범위 검사 | 저장된 현재 값으로 전투 능력치 계산 | 포인트를 정상적으로 획득·소비했는지, 초기화 비용을 지불했는지 검증하지 않음 |
| 장비, 장비 능력치·효과, 인벤토리 | 클라이언트 장비 굴림·강화·분해·장착 로직 | 슬롯/희귀도/레벨/통계 키, 효과 ID·개수, 고유 ID 등 구조 제약 | 현재 장비 상태에서 PvP 및 스테이지 전투 스냅샷 계산 | 유효한 모양의 장비가 합법적인 드롭·강화로 생성됐다는 증거가 없음 |
| 골드·재료 | 클라이언트 전투 보상 및 장비 경제 | 골드는 안전한 0 이상 정수, 재료는 유한한 0 이상 숫자 | 없음(현재 CloudSave PUT의 provenance 검사 기준) | 클라이언트가 만든 잔액·소비 내역을 구분할 원장이 없음 |
| 스테이지·챕터 진행도 | 클라이언트의 스테이지 완료 로직 | 스키마와 문자열 형태 검사 | 랭킹 티켓 발급 시 요청 스테이지가 저장 데이터상 열렸는지 확인 | CloudSave를 직접 바꾸면 unlock/clear 기록을 선행시킬 수 있음 |
| CloudSaves revision | API 및 SQL `Revision` | create 전용 키와 `PlayerId + expected Revision` CAS | 같은 사용자 계정의 현재 revision과 저장 충돌 | CAS는 최신 저장 여부만 판별하고, 값의 합법성은 판별하지 않음 |
| PlayerSnapshots | API가 CloudSaves를 읽어 캐릭터/장비/전투 값을 파생 | 저장 revision 일치, balance version, 서버 파생 및 검증 | 파생 전투값과 고정 스냅샷 | 원본 CloudSave의 게임 이력이 검증된 것은 아님 |
| 랭킹 런 입력과 기록 | 클라이언트가 이동/레벨업 입력 기록을 제출, 서버가 ticket과 함께 재생 | 입력 형식·용량·티켓 만료·simulator/balance version·결과·시간 검사 | 기록된 전투 결과와 최고 기록 | 출발 프로필은 client-owned CloudSave로부터 계산됨. 랭킹 승인이 보상/프로필 신뢰를 보증하지 않음 |
| PvP 입력, 결과, Elo | 클라이언트 입력 제출, 서버가 고정된 두 스냅샷으로 재생 | 입력·만료·버전 검사, 결과 재생, 트랜잭션 내 Elo/경기 저장, 일일 상대 중복 방지 | 승패와 Elo | 두 전투 스냅샷의 능력치는 CloudSave로부터 파생됐지만 그 생성 이력은 client-owned |

### Cloud save 검증과 충돌 동작

브라우저 `saveStore`는 v2 상태를 검사하고 `localStorage`에 저장한다. 계정 coordinator는 Entra tenant ID와 object ID로 로컬 키를 분리하며, 서버는 인증 identity를 `Players`의 `PlayerId`로 매핑한다. Cloud save API는 v2 payload를 정규화하고 허용 필드를 다시 기록한다. CloudSaves 업데이트는 기대 revision이 맞을 때만 revision을 증가시킨다.

오프라인이면 로컬 상태를 계속 사용할 수 있고, 네트워크가 돌아오면 미동기화 상태를 PUT으로 재시도한다. 409 충돌 시 현재 클라우드 상태를 설치하고 달라진 로컬 직렬화 값은 계정별 recovery 키로 보관한다. 이 과정은 자동 병합이 아니며 어느 쪽이 더 많은 합법 보상을 포함하는지 판단하지 않는다. 계정 전환 뒤 늦게 도착한 이전 계정 요청은 generation 검사로 무시한다. `localStorage`와 recovery 사본은 같은 브라우저 사용자가 수정할 수 있다.

v1→v2 로컬 마이그레이션은 레벨·XP·재료·진행도와 장비 정체성을 보존한다. 새 기본 능력치와 레벨 기반 능력치 포인트를 적용하고, 장비 수치는 저장된 강화 이력 없이 밸런스표의 중간 증가율로 재산정하며, HP 비율을 유지하고 골드는 0으로 설정한다. 이전 직렬화 원본은 마이그레이션·충돌 상황에서 복구 사본으로 남길 수 있다. API는 저장된 schemaVersion 1/2를 읽어 v2 형태로 정규화하지만 신규 쓰기 payload는 v2만 받는다. 이 변환은 형식 호환을 제공할 뿐 과거 보상의 출처를 복원하지 못한다.

## 온라인 재생 흐름

### 랭킹 스테이지

1. 클라이언트는 챕터/스테이지와 `expectedSaveRevision`으로 티켓을 요청한다.
2. API는 인증된 PlayerId의 CloudSave를 읽고 revision, 저장 데이터상 접근 가능 여부, 전투 스냅샷을 검사한다. 서버가 run ID, seed, 발급/만료 시각, simulator/balance version과 파생 스냅샷을 ticket row에 저장한다.
3. 클라이언트는 이동·레벨업 입력 로그를 제출한다. API는 고정 ticket/snapshot과 해당 입력을 재생하고 clear 여부, 시간과 버전을 검사해 StageRuns/StageBests를 기록한다. 같은 ticket의 결과 재전송은 같은 입력인지 비교해 중복 처리한다.
4. 게임은 이 흐름과 별도로 클라이언트에서 적 처치 보상, XP, 스테이지 보상, 레벨업 및 진행도 변경을 계산한다. 완료 직후 `saveState`로 전체 CloudSave를 기록한다. 서버 stage replay는 이 보상 변경을 계산하거나 CloudSaves에 적용하지 않는다.

### 비동기 PvP

1. 클라이언트는 기대 CloudSave revision만 제출한다. API는 해당 계정의 CloudSave에서 캐릭터·장비·전투 스냅샷을 계산해 PlayerSnapshots에 저장하고 snapshot revision과 balance version을 붙인다.
2. 매칭은 두 유효 스냅샷 revision을 고정해 match ID, seed, simulator/balance version과 만료를 포함한 티켓을 만든다.
3. 결과 입력 제출 시 서버는 두 고정 스냅샷을 재생해 승패를 정하고 SQL 트랜잭션에서 match 결과와 대상별 Elo를 갱신한다. 서버 응답 재시도는 저장된 입력과 비교해 멱등 처리한다. 현재 PvP 결과는 게임 재화나 장비를 주지 않는다.

두 재생 시스템 모두 입력과 전투 산출물 검증에는 의미가 있지만, 입력 전의 CloudSave가 정상적인 플레이 기록에서 만들어졌는지 보증하지 않는다.

## 권위 모델 비교

| 모델 | API/명령 및 권위 데이터 | 재전송·버전 | v2 이행·오프라인·충돌 | 비용·위험 감소 |
| --- | --- | --- | --- | --- |
| **1. client-owned CloudSaves 유지, 경쟁 스냅샷만 더 엄격히 검증** | 기존 CloudSave GET/PUT와 snapshot publish를 유지. 서버는 허용 범위와 밸런스 제약을 강화하고 경쟁 전투용 snapshot을 파생. 나머지 프로필은 계속 클라이언트 작성 | 저장 revision CAS와 ticket/match 중복 처리는 유지. 스냅샷 검증은 현재 balance/simulator version에 고정 | v2를 거의 그대로 유지하고 오프라인/현재 recovery 동작에 가장 잘 맞음. 기존 CloudSaves 계약 변경이 작음 | 구현이 작고 잘못된 통계·형식의 진입을 줄일 수 있으나, 허용 범위 안의 불법 보상이나 장비를 증명해 막지는 못함 |
| **2. 온라인 보상·진행도는 서버 권위, 오프라인 프로필은 별도 로컬 진행 및 명시적 조정** | 기존 ticket 시작/결과 API를 확장해 완료 보상과 진행도 적용을 서버 트랜잭션으로 처리. 고유 run ID 기반 보상 원장을 두고 CloudSave revision과 함께 XP/레벨/골드/재료/드롭/해금 중 선택된 온라인 필드를 갱신. 오프라인 이벤트를 위한 별도 제출/조정 명령을 설계 | `runId` 또는 command ID에 unique 제약을 두고 같은 요청 재시도는 동일 결과 반환. 보상 산식·시뮬레이터·밸런스 버전과 drop seed를 기록 | 기존 v2를 백업/가져오기 경로로 유지하되, 최초 import의 보상 출처를 판정하지 못하는 점을 처리해야 함. 온라인 권위 값은 로컬에서 덮어쓸 수 없게 분리하거나 필드 소유권을 정의. 오프라인 보상은 로컬 shadow에 먼저 표시할지, 검증 후 확정할지 선택 필요. 충돌은 revision과 command 결과를 기준으로 처리 | 중간 크기. 경쟁 가치가 높은 보상에 원장을 만들 수 있지만 온라인/오프라인 프로필 차이, 조정 규칙, 재화 이중 집계가 주요 위험 |
| **3. 전체 프로필/보상 경제를 서버 명령으로 변경** | `start/complete stage`, `allocate/reset stats`, `equip/upgrade/dismantle`, `claim/drop`, 재료·골드 증감 등 모든 변경을 인증 명령으로 적용. 서버가 잔액, 아이템 ID/능력치, 보상 seed, 해금 및 거래 전후 상태를 소유 | 모든 명령에 idempotency key와 expected profile revision을 요구하고 원장/프로필 갱신을 원자적으로 수행. 과거 적용에 필요한 simulator/balance version을 보존 | v2는 단 1회 import·백업 경로가 필요. 브라우저 오프라인은 조회 또는 미확정 로컬 shadow만 허용하거나 제한된 명령 큐를 설계해야 함. 동시 기기 명령은 서버 revision 순서에 따라 충돌 응답 후 재조회 | 가장 많은 작업과 API/DB 표면이 필요하지만 client-owned economy 공격 면을 가장 크게 줄임. 네트워크 의존성과 오프라인 경험 비용이 큼 |

세 모델 모두 현재 Entra 인증과 PlayerId account isolation을 유지할 수 있다. 서버 명령은 반드시 사용자 ID에 묶고, 프로필/원장 갱신을 원자적으로 처리해야 한다. 현재 256 KiB JSON CloudSave 단일 저장 구조는 1번에 가장 잘 맞는다. 모델 2는 run 보상 원장과 필드 소유권 분리, 모델 3은 profile command/ledger용 저장 구조와 보상 조회 계약을 추가할 가능성이 높다.

### API/명령 구체화

현재 경로는 `GET/PUT /api/saves/current`, `POST /api/stage-runs`, `POST /api/stage-runs/{runId}/result`, `PUT /api/pvp/snapshot`, `POST /api/pvp/matches/search`, `POST /api/pvp/matches/{matchId}/result`다. 모델 1은 기존 계약 안에서 snapshot publish 시 서버 검증 규칙을 강화한다. 모델 2는 stage result 처리에서 보상 산정과 원장 기록을 함께 하고, 오프라인 기록을 받아들인다면 별도 `POST /api/profile/offline-events` 형태의 재조정 명령을 추가한다. 모델 3은 `POST /api/profile/commands`에 `allocate-stat`, `reset-stats`, `equip`, `upgrade`, `dismantle`, `claim-drop` 등의 명령을 보내며, 읽기는 서버가 반환한 profile/revision을 사용한다. 신규 경로명은 구현 전 API 계약에서 확정할 제안이다.

## 권고 단계

1. **현재 v2 보존**: 기존 CloudSaves를 덮어쓰거나 자동으로 재평가하지 않는다. import 시 원본 백업, 신규 서버 상태, 미검증 레거시 상태를 구분하고 사용자가 회수할 수 있는 경로를 만든다.
2. **경쟁 진입값을 보호**: 현 스테이지/PvP 서버 파생을 유지하되, 밸런스 버전에 맞는 장비/능력치 유효성 및 상한을 별도 결정한다. 스키마 검사와 provenance 검사를 UI/운영 정책에서 구분한다. 유효성 상한은 기존 정상 저장 호환성을 측정하기 전에 단순 축소하지 않는다.
3. **모델 2의 작은 첫 slice**: 온라인 stage ticket 결과에서 XP/골드/재료/장비 드롭/해금 중 사용자가 선택한 필드만 서버가 계산하고 한 번만 지급하도록 한다. 이 단계에서 PvP Elo는 그대로 두고 게임 보상을 붙이지 않는다. 서버 보상은 stable `runId`/command ID, simulator/balance version 및 server seed에 묶고 CloudSave revision 업데이트와 같은 트랜잭션 경계를 정한다.
4. **오프라인과 경제를 분리해 결정**: 오프라인 보상을 즉시 확정·나중에 조정할지, 온라인 권위 보상만 확정할지 먼저 정한다. 그 결정 뒤 장비 강화/분해·스탯 배정까지 이동할 필요가 확인될 때 모델 3을 검토한다.

이 권고는 설계 제안이다. 이번 task에서는 API, DB, save format, Azure나 배포 상태를 변경하지 않았다.

## 다음 구현 전에 필요한 사용자 결정

1. 권위 전환 목표를 선택한다: **1** 경쟁 스냅샷 검증만 강화, **2** 온라인 보상·진행도 권위화(권고), **3** 전체 프로필 경제를 서버 명령으로 이동.
2. 첫 구현에서 서버 권위가 필요한 필드를 선택한다: **A** 전투/랭킹 스냅샷과 접근 해금, **B** A + XP·레벨·골드·재료·드롭·인벤토리·스테이지 진행(권고), **C** B + 능력치 배정/초기화 및 장비 장착·강화·분해.
3. 오프라인 플레이 보상을 온라인 서버 상태에 반영하는 정책은 별도 선택이 필요하다. 선택 전까지는 오프라인 데이터는 계속 복구 가능해야 하며 온라인 권위 기록으로 자동 승격하지 않는 방향이 안전하다.

## 조사 근거

- `src/game/domain/saveStore.js`, `src/game/domain/accountSaveCoordinator.js`
- `packages/game-rules/src/saveMigration.js`
- `api/src/domain/cloudSave.js`, `api/src/services/cloudSaveService.js`, `api/src/repositories/cloudSaveRepository.js`
- `api/src/services/stageRunService.js`, `api/src/repositories/stageRankingRepository.js`, `api/src/domain/stageRank.js`
- `api/src/services/playerSnapshotService.js`, `api/src/services/matchmakingService.js`, `api/src/services/pvpResultService.js`, `api/src/repositories/pvpRepository.js`
- `src/game/scenes/BattleScene.js`, `src/game/domain/gear.js`, `src/game/domain/progression.js`
- `.memory/decisions/2026-10-21-internal-online-ranking-pvp.md` (D09, D12–D13)
- `.memory/decisions/2026-10-22-character-gear-balance.md` (v1→v2 and balance decisions)

이 검토는 위 코드와 문서의 정적 대조다. Azure/live service 실행, 사용자별 실제 저장 데이터, 공격 재현은 조사하지 않았다.
