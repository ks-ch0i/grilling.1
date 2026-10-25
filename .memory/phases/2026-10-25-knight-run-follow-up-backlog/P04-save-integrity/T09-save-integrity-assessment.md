# Task: T09 저장 데이터 무결성 평가

## Status: pending

## Goal
게임 저장과 PvP·랭킹 입력의 신뢰 경계를 코드 근거로 정리하고, 오프라인 진행·기존 계정 저장을 보존하는 서버 검증/권위형 전환안을 제안한다. 이 Task는 분석 문서만 만들고 저장 API나 DB를 수정하지 않는다.

## Decision Summary
- 현재 결정에서 수용한 client-owned save risk를 다시 평가하되, 특정 서버 권위 모델을 사전 승인된 것으로 취급하지 않는다.
- 구현 후보는 모델, API 계약, 마이그레이션, offline reconciliation, 온라인 PvP·랭킹 검증 순서와 함께 비교해 사용자가 다음 단계 범위를 선택하게 한다.

## Implementation

### I01. 현재 신뢰 경계와 저장 필드 조사

- Related Files:
  - src/game/domain/accountSaveCoordinator.js :: local/cloud save lifecycle, offline recovery, revision conflict; read-only
  - src/game/domain/saveStore.js :: schemaVersion 2 client validation; read-only
  - packages/game-rules/src/saveMigration.js :: v1→v2 migration; read-only
  - api/src/domain/cloudSave.js :: cloud state schema validation; read-only
  - api/src/services/cloudSaveService.js :: getCurrent, putCurrent — client payload acceptance; read-only
  - api/src/repositories/cloudSaveRepository.js :: compareAndSwap — revision guard; read-only
  - api/src/services/stageRunService.js :: ranked replay validation; read-only
  - api/src/services/playerSnapshotService.js :: PvP snapshot source/revision checks; read-only
  - api/src/services/pvpResultService.js :: PvP server replay and result transaction; read-only
  - .memory/decisions/2026-10-21-internal-online-ranking-pvp.md :: D09 accepted risk; read-only
  - .memory/decisions/2026-10-22-character-gear-balance.md :: schema v2 fields; read-only

#### Details
- Data & Schema Fields:
  - Inventory to assess: player level/xp/xpToNext/pendingLevelUps/currentHp/baseStats/availableStatPoints/spentStatPoints/statResetCount; equipment slots and item id/slot/rarity/level/stats/effects; inventory; materials; gold; progression unlocked/cleared stages.
  - Online records to assess: CloudSaves JSON/revision, PlayerSnapshots JSON/revision/balance version, stage run ticket snapshot and replay inputs, PvpMatches snapshots/input/result and PvpRatings.
- **Execution Flow / Logic**:
  1. For each field, record the writer (browser, API, simulator), current validation, persistence location, restore/migration behavior, and whether the server can independently derive it.
  2. Distinguish schema validation and compare-and-swap revision protection from gameplay provenance validation. Do not describe a validated JSON envelope as proof that its gold, item stats or progression were legitimately earned.
  3. Trace ranked stage replay and PvP match replay from ticket creation through submission. Identify which starting snapshots originate in cloud state and which event results are recomputed by the server.
  4. Record offline-only progression, cloud conflict backup, legacy v1 migration, account switching, and snapshot revision coupling as compatibility constraints.
  5. Do not write production code, change schemas, alter saved values, contact Azure, or deploy.

### I02. 전환 모델 비교와 결정 요청

- Related Files:
  - .memory/decisions/YYYY-MM-DD-knight-run-save-integrity-review.md :: trust map, options, recommendation and follow-up decision; new at execution date
  - .memory/plans/2026-10-25-knight-run-follow-up-backlog.md :: scope context; read-only

#### Details
- **Models to compare**:
  1. Keep CloudSaves as client-owned and validate only competitively relevant snapshot fields.
  2. Make the server authoritative for online rewards and progression while keeping an offline local profile with explicit reconciliation.
  3. Move the entire profile and reward economy to server commands, including stat allocation, gear upgrades, drops, gold, materials and stage progression.
- **Execution Flow / Logic**:
  1. For each model, list exact server APIs/commands, authoritative fields, anti-replay/idempotency requirements, simulator/balance version impacts, v2 save migration, conflict behavior and offline limitations.
  2. Compare implementation size, attack surface reduced, existing game compatibility, and which fields remain client-controlled.
  3. Recommend a staged approach that protects competitive snapshots and high-value rewards before any full profile migration, while keeping existing v2 data recoverable.
  4. Write the decision review with a threat map, model comparison, preferred sequence, unresolved decisions and explicit statement that no save data or production code changed.
  5. Ask the user to select the model and fields before creating a separate implementation plan.

## Acceptance Criteria
- [ ] Each saved field and online competitive payload has a documented writer, validator, source and trust level.
- [ ] Compare-and-swap conflict handling is not confused with gameplay anti-cheat validation.
- [ ] Offline saves, v1→v2 migration, account isolation, local recovery copies and revision conflicts are called out as migration constraints.
- [ ] At least the three described authority models are compared with API/data/migration consequences.
- [ ] No code, schema, user save, Azure resource or deployed service is changed.
- [ ] A concrete user decision is requested before implementing an authority migration.

## Validation
- Static audit against the listed source files and existing decision documents.
- Confirm the output review does not claim live-service verification or successful exploits.
- No tests are required because this Task changes no implementation code.

## Commit Message
~~~text
docs(security): assess game save trust boundaries

Plan: 2026-10-25-knight-run-follow-up-backlog
Phase: P04-save-integrity
Task: T09-save-integrity-assessment

- Map client and server ownership for saved progression and online inputs
- Compare migration options without changing production state
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
