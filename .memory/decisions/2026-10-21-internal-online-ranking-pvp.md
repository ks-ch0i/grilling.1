# Decisions: 사내 온라인 랭킹 및 비동기 PvP

- Date: 2026-10-21
- Status: Confirmed
- Scope: 설계 결정과 실행계획 작성. 이 문서 생성 단계에서는 게임 코드나 Azure 리소스를 변경하지 않는다.

## D01. 배포 대상과 접근 경계
- **Chosen**: 사내 배포용 온라인 게임이다. HTTPS 주소는 인터넷에서 접근할 수 있지만, 게임과 API는 회사 Microsoft Entra 단일 테넌트 로그인 사용자만 이용한다. VPN은 요구하지 않는다.
- **Rationale**: 사내 사용자는 사무실 밖에서도 접속할 수 있어야 하며, 회사 계정으로 접근을 제한한다.

## D02. 로그인과 계정 식별
- **Chosen**: 로그인을 필수로 한다. 브라우저 MSAL 인증은 silent SSO를 먼저 시도하고, 상호작용이 필요한 오류에서만 loginPopup을 연다. 서버 계정 키는 Entra tenant ID와 object ID 조합을 사용한다.
- **Rationale**: 저장 데이터를 계정별로 나누고 기존 사내 계정 체계를 활용한다. 첫 로그인은 네트워크가 필요하며 완전한 무화면 첫 로그인을 보장하지 않는다.

## D03. 기존 로컬 저장 데이터 연결과 충돌
- **Chosen**: 처음 로그인할 때 계정의 클라우드 저장이 없으면 기존 로컬 저장을 해당 계정에 한 번 올린다. 클라우드 저장이 이미 있으면 클라우드 데이터를 우선하고, 충돌한 로컬 사본은 복구용으로 별도 보존한다. 계정마다 브라우저 저장 키와 클라우드 저장을 분리한다.
- **Rationale**: 기존 플레이 진행을 보존하면서 여러 사용자가 같은 브라우저를 써도 저장 데이터가 섞이지 않게 한다.

## D04. 오프라인 동작
- **Chosen**: 첫 온라인 로그인이 끝난 계정은 일시적인 연결 끊김 중에도 캐시된 게임 저장으로 스테이지 게임을 계속할 수 있다. 오프라인 진행 저장은 연결 복구 후 계정 저장에 동기화하지만 랭킹 점수로 제출하지 않는다. PvP는 오프라인에서 사용할 수 없다.
- **Rationale**: 기본 플레이는 연결 장애에 견디게 하되, 서버가 검증할 수 없는 기록은 경쟁 랭킹에 넣지 않는다.

## D05. Azure 서비스 구성
- **Chosen**: 기존 유사 리소스는 재사용하지 않고 사용자 구독에 전용 리소스를 만든다. Static Web Apps Standard와 연결된 별도 JavaScript Azure Functions Flex Consumption API를 사용한다. 데이터베이스와 SignalR도 새 전용 리소스로 만든다.
- **Rationale**: 별도 Functions 앱은 독립 런타임·관리 ID를 사용하며 Static Web Apps의 API 연결에는 Standard 요금제가 필요하다. Azure Functions Flex Consumption은 선택된 서버리스 API 실행 방식이다.
- **References**: [Static Web Apps BYO Functions](https://learn.microsoft.com/en-us/azure/static-web-apps/functions-bring-your-own), [Azure Functions Flex Consumption](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan).

## D06. 데이터베이스와 실시간 전송 요금제
- **Chosen**: 새 Azure SQL Database General Purpose의 Provisioned compute를 사용한다. Azure SignalR Service는 Free tier 한 개 단위로 시작한다. 랭킹은 SignalR 이벤트로 갱신하고, 연결 복구 시 HTTP polling으로 보완한다.
- **Rationale**: 사용자는 상시 준비된 SQL을 선택했고 SignalR Free를 선택했다. Provisioned SQL은 사용이 없을 때도 compute가 시간 단위로 과금된다. SignalR Free는 Dev/Test 전용으로 표시되고 동시 연결 20개, 일일 메시지 20,000개, 추가 메시지 0개 제한이 있다. 실제 확장 사용 전에 이 제한을 운영 기준과 대조해야 한다.
- **References**: [Azure SQL Database 비용 관리](https://learn.microsoft.com/en-us/azure/azure-sql/database/cost-management), [Azure SignalR Service limits](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits), [Azure SignalR pricing](https://azure.microsoft.com/en-us/pricing/details/signalr-service/).

## D07. 랭킹 화면
- **Chosen**: 인게임 상단 전광판을 계속 표시한다. 스테이지와 PvP 상위 5명을 번갈아 보여주고, 현재 계정의 순위 변동 알림도 표시한다. 실시간 이벤트를 우선 사용하고 연결이 끊기면 polling으로 복구한다.
- **Rationale**: 별도 랭킹 메뉴를 열지 않아도 경기 상태와 경쟁 상황을 확인할 수 있다.

## D08. 스테이지 랭킹 기준
- **Chosen**: 가장 높은 클리어 스테이지를 우선하고, 같은 스테이지에서는 서버가 측정한 성공 전투 시간을 짧은 순서로 정렬한다. 재도전으로 해당 스테이지 최고 기록을 갱신할 수 있다. 온라인 티켓 검증을 통과한 기록만 경쟁 랭킹에 반영한다.
- **Rationale**: 진행도와 숙련도를 함께 반영하고 클라이언트 시계를 신뢰하지 않기 위해 서버가 시작 시각과 난수 시드를 발급한다.

## D09. 랭킹 검증 경계와 수용 위험
- **Chosen**: 서버는 스테이지의 완료 여부와 시간을 입력 기록 재생으로 검증한다. 경험치, 장비, 재료, 레벨 진행 저장은 클라이언트 로컬에서 계속 계산하고 계정 클라우드 저장에 동기화한다.
- **Rationale**: 경쟁 기록 위변조 방지를 서버 검증 범위로 한정하고 기존 진행 저장을 서버 권위형으로 전환하지 않는다.
- **Accepted risk**: 동기화되는 저장 값과 장비 스탯 자체는 클라이언트에서 조작될 수 있다. 따라서 유효 스테이지 재생을 통과하더라도 시작 능력치의 정당성까지 증명하지는 않는다. 이 계획에서 경제·진행 데이터 전체를 서버 권위형으로 바꾸지 않는다.

## D10. PvP 상대와 전투 방식
- **Chosen**: PvP는 동시 접속 대전이 아니라 자동 공개된 상대 캐릭터·장비 스냅샷을 상대로 하는 비동기 전투다. 상대 스냅샷은 장비나 캐릭터가 바뀔 때 갱신한다. 별도 이동 AI는 두지 않는다. 현재 몸통 접촉 전투처럼 상대는 고정 위치에 있고 플레이어가 접촉하면 양쪽 피해를 계산한다.
- **Rationale**: 현재 전투는 좌우 이동으로 적과 몸통 접촉해 피해를 주고받는 구조이며 적 이동 AI가 없다. 추가 추격 동작 없이 기존 전투 방식을 재사용한다.

## D11. PvP 매칭과 결과 규칙
- **Chosen**: 유사 레이팅 상대부터 찾고 대기 중 허용 레이팅 범위를 넓힌다. 초기 레이팅은 1000, Elo K값은 32이며 양쪽 레이팅을 함께 변경한다. 시즌은 두지 않는다. 같은 상대와는 UTC 날짜 기준 하루 한 경기만 레이팅에 반영한다. 제한 시간은 60초이며, 종료 시 남은 HP 비율이 높은 쪽이 승리한다. 정확히 같으면 무승부로 레이팅을 바꾸지 않는다.
- **Rationale**: 대기시간과 상대 수준을 절충하고, 비동기 대전 결과를 공통 기준으로 계산한다.
- **Implementation default**: 초기 매칭 범위와 확대 간격은 API 설정값으로 분리하고 계획 기본값을 초기 ±100, 5초마다 ±100 확대, 최대 ±500으로 둔다. 실제 운영 데이터에 따라 조정한다.

## D12. PvP 결과 검증
- **Chosen**: 클라이언트가 전투 입력 기록을 제출하면 서버가 발급한 경기 ID·난수 시드와 양쪽 스냅샷으로 서버가 전투를 재생한다. 서버가 승패를 계산하고 한 SQL 트랜잭션에서 양쪽 Elo와 경기 기록을 갱신한다.
- **Rationale**: 실시간 입력 왕복 지연 없이 비동기 대전을 유지하면서 결과 검증을 서버에 둔다. 스테이지와 같은 결정적 재생 엔진을 사용한다.

## D13. 전투 재생 규약
- **Chosen**: 브라우저와 API가 같은 버전의 순수 JavaScript 게임 규칙을 공유한다. 60Hz 고정 스텝, 서버 시드 난수, 이동 방향 변경 이벤트, 레벨업 선택 이벤트를 사용한다. 규칙 버전과 전투 시작 능력치 스냅샷을 티켓에 고정한다.
- **Rationale**: 현재 Phaser 전투는 프레임 delta와 Math.random()에 의존하므로 서버 재생이 불가능하다. 게임 표시 코드와 규칙 계산을 분리해야 브라우저와 Node 서버가 같은 결과를 만들 수 있다.

## D14. 배포 준비 경계와 기본값
- **Chosen**: 이번 작업은 결정 문서와 상세 계획 수립만 한다. 실제 Azure 리소스 생성·배포는 계획의 별도 마지막 단계로 남긴다. 해당 단계 전 리소스 그룹과 위치를 지정하고 Provisioned SQL의 지속 비용 및 SignalR 제한을 재확인한다.
- **Rationale**: 사용자는 내부 배포 구성을 선택했지만 이 대화에서 리소스 생성이나 지출 승인을 요청하지 않았다. 위치는 현재 게임 Static Web App과 같은 East Asia를 계획 기본값으로 두되 리소스 생성 전에 확정한다.

## 자동 확인된 코드 제약
- 현재 저장은 localStorage 단일 키 schemaVersion 1이며 저장·복구 검증은 브라우저 안에서만 수행한다.
- 현재 BattleScene은 Phaser update의 delta 시간으로 이동하고 접촉 시 Math.random 기반 치명타를 계산한다. 스테이지 시간, 서버 티켓, 이동 입력 기록, 계정, API, 랭킹, PvP는 아직 없다.
- 현재 적은 고정 위치이고 접촉이 해제된 뒤 재접촉할 때 다시 피해를 계산한다. 이 방식과 충돌 순서를 보존해야 기존 플레이 감각이 유지된다.
- 기존 저장 형식과 게임 보상 계산은 바꾸지 않고 계정별 저장 어댑터 및 랭킹 전용 전투 계약을 추가한다.

## 요청 범위 밖에 남긴 사항
- SignalR Free의 Dev/Test 한계와 한도 초과 시 Standard 전환 비용은 운영 사용량을 본 뒤 결정한다.
- SQL vCore 수와 위치, 리소스 그룹은 배포 직전 비용·용량 검토에서 확정한다. 계획 기본 위치는 East Asia다.
- 저장 데이터 전체의 서버 권위형 검증, 장비·재료 부정 방지, 다중 시즌은 이번 범위에 넣지 않는다.
