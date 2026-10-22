# Task: T06 클라우드 저장 v1 읽기 이행과 v2 쓰기

## Status: done

## Goal
API가 저장된 v1 클라우드를 새 규칙의 schemaVersion2 상태로 읽어 반환하고, 이후의 새/갱신 요청은 v2만 저장하도록 한다. GET 요청 자체는 DB를 바꾸지 않는다.

## Decision Summary
- API와 브라우저는 packages/game-rules의 동일 migrateGameState 함수를 사용한다.
- 저장된 CloudSaves.SchemaVersion=1은 GET에서 v2 envelope로 변환해 반환하되 revision/UpdatedAtUtc는 그대로 둔다. 다음 정상 v2 PUT이 원본 row를 갱신한다.
- 새 API는 v1 PUT을 거절해 구버전 클라이언트가 새 저장을 v1로 되돌리지 못하게 한다. SQL의 현재 SchemaVersion >=1 제약은 2를 이미 허용한다.

## Implementation

### I01. API read migration/write gate
- Related Files:
  - api/src/domain/cloudSave.js :: validateCloudSave, parseCloudSave, canonical state — schema v2; modify.
  - api/src/services/cloudSaveService.js :: getCurrentCloudSave, putCurrentCloudSave — read migration/write v2; modify.
  - api/src/functions/cloudSave.js :: PUT request validation and error mapping — schema v2; modify.
  - api/src/repositories/cloudSaveRepository.js :: insert/update SchemaVersion parameter — persists 2; modify only if hard-coded.
  - packages/game-rules/src/saveMigration.js :: migrateGameState — T02 output; read-only.
  - src/api/cloudSaveClient.js :: putCurrent JSON body — send schemaVersion 2; modify.

#### Details
- Signatures & Types:
  ~~~js
  validateCloudSave(body: unknown): {schemaVersion:2,state:GameStateV2}
  parseCloudSave(row: {SchemaVersion:number,Revision:number,SaveJson:string,UpdatedAtUtc:Date}): CloudEnvelopeV2
  CloudEnvelopeV2 = {schemaVersion:2,revision:number,updatedAtUtc:string,state:GameStateV2}
  ~~~
- Execution Flow / Logic:
  1. validateCloudSave accepts only body.schemaVersion===2 and state.schemaVersion===2. Invalid/legacy PUT is mapped to existing 400 validation response; it must not create or update a row.
  2. parseCloudSave accepts matching DB row versions 1 or 2. For version1, parse JSON and call shared migration; for version2 validate without migration. A row version / JSON schema mismatch or corrupt state remains an error.
  3. GET returns schemaVersion2 with the row's unchanged revision and updatedAtUtc. GET never performs a write or revision increment.
  4. POST/create and conditional PUT/update persist SchemaVersion=2 and canonical v2 JSON. Existing If-None-Match/If-Match revision semantics stay unchanged.
  5. playerSnapshotService and stageRunService callers receive migrated state because they use parseCloudSave; do not create a second migration implementation in those services.
  6. cloudSaveClient sends schemaVersion2 and keeps existing authentication, conditional headers and status handling.

### I02. API cloud save tests
- Related Files:
  - api/test/cloudSave/cloudSaveService.test.js :: v1 GET conversion, v2 validation, v1 write rejection; modify.
  - api/test/cloudSave/cloudSaveFunction.test.js :: route status/body contract; modify.
  - api/test/stageRuns/startStageRun.test.js :: v1 cloud row fixture migration when building current combat snapshot; modify only if fixture contract changes.
  - api/test/pvp/playerSnapshotService.test.js :: legacy cloud row snapshot migration; modify only if fixture contract changes.
  - test/api/cloudSaveClient.test.js :: outgoing schemaVersion2; modify.

#### Details
- Verify v1 row becomes v2 in the returned envelope without changing revision/time, and repeated reads produce equivalent state.
- Verify v2 row stays v2, mismatched SQL/JSON schema rejects, malformed JSON rejects, v1 PUT returns the existing 400 validation shape, and v2 PUT stores schemaVersion2.
- Verify revision conflicts and If-None-Match behavior do not change.

## Acceptance Criteria
- [x] v1 cloud data is readable through the shared deterministic migration and is not modified by GET.
- [x] API and browser client only write schemaVersion2.
- [x] Old v1 clients cannot overwrite a v2 cloud state.
- [x] Existing optimistic concurrency and player snapshot consumers still work.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- npm --prefix api test — 모든 API 저장/인증/회귀 테스트가 통과해야 한다.
- node --test test/api/cloudSaveClient.test.js — 브라우저가 schemaVersion2를 전송하는지 확인한다.
- Node.js 22.12.0 `npm --prefix api test`: 69/69 통과.
- Node.js 22.12.0 `node --test test/api/cloudSaveClient.test.js`: 7/7 통과.
- Node.js 22.12.0 Vite production build 통과. 기존 500 kB chunk 경고가 남아 있다.
- `git diff --check`: 통과.

## Commit Message
~~~text
feat(api): migrate cloud saves to schema v2

Plan: 2026-10-22-character-gear-balance
Phase: P02-online-compatibility
Task: T06-cloud-save-v2

- Read and convert legacy cloud rows without changing revisions
- Require v2 for all new cloud save writes
~~~

## Progress
- [x] 구현 완료
- [x] 검증 통과
- 비판적 리뷰에서 package export 사용과 브라우저 중첩 state 버전 검사를 요구해 반영했다. 재검토에서 추가 Critical/Important 지적이 없었다.
- commit: 지정 T06 커밋 메시지 사용.
