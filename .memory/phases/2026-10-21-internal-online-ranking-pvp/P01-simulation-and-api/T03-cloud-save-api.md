# Task: T03 계정별 클라우드 저장 API

## Status: pending

## Goal
로그인 계정 하나에 저장 상태 하나를 보관하고 revision 기반 조건부 저장을 제공해 클라이언트가 충돌을 감지하고 클라우드 우선 정책을 적용할 수 있게 한다.

## Decision Summary
- cloud save는 기존 schemaVersion 1 game state를 JSON으로 보존하고 revision을 서버에서 증가시킨다.
- 클라우드가 있으면 클라우드 우선, 클라우드가 없을 때만 로컬 최초 저장을 등록한다. 서버는 장비·재료·경험치 값을 게임 규칙 기준으로 검증하지 않는다.

## Implementation

### I01. Save DTO와 저장소 API
- Related Files:
  - api/src/domain/cloudSave.js :: validateCloudSave, parseCloudSave — 저장 envelope 검증; new.
  - api/src/repositories/cloudSaveRepository.js :: getByPlayerId, insertInitial, compareAndSwap — SQL access; new.
  - api/src/services/cloudSaveService.js :: getCurrent, putCurrent — revision rules; new.
  - api/src/functions/cloudSave.js :: GET/PUT /api/saves/current — HTTP routes; new.
  - api/test/cloudSave/cloudSaveService.test.js :: revision and conflict cases; new.
- Details:
  - CloudSaveEnvelope: { schemaVersion: 1; revision: integer >= 1; updatedAtUtc: ISO-8601 UTC string; state: SaveStateV1 }.
  - SaveStateV1은 현재 saveStore.js의 isValidState 조건과 같은 필드·타입을 갖는다: player(level,xp,xpToNext,pendingLevelUps,currentHp,baseStats), equipment의 6 slot, inventory, materials, progression(chapter,currentStage,unlockedChapter,unlockedStage,clearedStageIds).
  - GET /api/saves/current: 저장이 없으면 404 { code:'save-not-found' }; 있으면 envelope를 반환한다.
  - PUT /api/saves/current는 JSON body { schemaVersion:1, state:SaveStateV1 }와 If-Match revision header를 받는다. 최초 저장은 If-None-Match:*만 허용한다.
  - 최초 생성 성공은 201 revision 1. revision 일치 수정은 transaction 내 revision+1 및 server UpdatedAtUtc를 기록하고 200을 반환한다. revision mismatch는 409 { code:'save-conflict', current:CloudSaveEnvelope }를 반환한다.
  - 저장 크기는 256 KiB 이하, 모든 JSON number는 finite, inventory 최대값은 현재 BALANCE.inventoryCapacity, 문자열 ID/enum은 현재 saveStore의 검증과 동일하게 확인한다.
  - ID는 request body에서 받지 않고 AuthContext로만 결정한다. 계정 A가 계정 B 저장을 읽거나 쓸 방법이 없어야 한다.

### I02. 데이터 안전 테스트
- Related Files:
  - api/test/cloudSave/cloudSaveFunction.test.js :: auth/isolation/http contract; new.
- Details:
  - 첫 계정 저장, 기존 revision 갱신, 오래된 revision 409, 없는 저장 404, 다른 사용자 격리를 검증한다.
  - invalid state, oversized body, SQL transient failure에서 기존 DB row가 손상되지 않고 적절한 400/503 응답을 반환한다.
  - 같은 revision을 두 요청이 동시에 사용하면 정확히 하나만 성공하고 다른 요청은 409가 되어야 한다.

## Acceptance Criteria
- [ ] 저장 API의 사용자 범위는 검증된 tenantId/objectId에만 묶인다.
- [ ] 클라우드 revision이 바뀐 상태를 덮어쓰지 않고 409로 돌려준다.
- [ ] 서버는 저장 데이터의 승격·병합·경제 조정을 하지 않는다.
- [ ] 기존 local save schemaVersion 1 payload가 추가 필드 없이 왕복된다.

## Validation
    npm --prefix api test -- cloudSave
    npm run build

## Commit Message
    feat(api): add revisioned per-account cloud saves

    Plan: 2026-10-21-internal-online-ranking-pvp
    Phase: P01-simulation-and-api
    Task: T03-cloud-save-api

    - Store one validated save envelope per Entra account
    - Reject stale revisions and return the current cloud copy

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
