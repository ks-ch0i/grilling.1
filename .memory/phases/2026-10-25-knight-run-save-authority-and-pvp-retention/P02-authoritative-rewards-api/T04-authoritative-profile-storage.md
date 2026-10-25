# Task: T04 서버 권위 프로필 저장과 CloudSave 병합

## Status: done

## Goal
서버 소유 reward/progression 값을 별도 profile 행에 저장하고 CloudSave의 client-owned 장비·능력치와 읽을 때 병합한다. 기존 v2의 미검증 보상은 archive에 보존하며 canonical profile은 초기값으로 시작한다.

## Decision Summary
- `CloudSaves.Revision`은 전체 저장의 CAS revision으로 계속 사용한다. 프로필 변경도 CloudSave와 함께 revision을 올린다.
- legacy v2 전체 원본은 복구용 archive에 보관하지만 XP·재화·인벤토리·진행도는 canonical profile 초기값에 복사하지 않는다.

## Implementation

### I01. Profile schema와 repository

- Related Files:
  - `api/migrations/005-authoritative-reward-profile.sql` :: reward profile, legacy archive schema/backfill; new
  - `api/src/repositories/playerProfileRepository.js` :: profile lock/read/write helpers; new
  - `api/src/domain/playerProfile.js` :: `defaultRewardProfile`, `parseRewardProfile`, `mergeRewardProfile`; new
  - `api/src/services/legacySaveRecoveryService.js` :: account-scoped legacy archive retrieval; new
  - `api/src/functions/legacySaveRecovery.js` :: authenticated `GET /profile/legacy-save`; new
  - `api/src/index.js` :: legacy recovery function registration; modify
  - `api/src/repositories/cloudSaveRepository.js` :: transaction profile reads/writes and global revision CAS; modify

#### Details
- **Signatures & Types**:
  ```js
  defaultRewardProfile() -> RewardProfile
  parseRewardProfile(row) -> RewardProfile
  mergeRewardProfile(clientState, profile) -> GameStateV2
  getRewardProfileByPlayerId(connection, playerId, {lock=false}) -> Promise<RewardProfileRow|null>
  createRewardProfile(transaction, playerId, profile, nowUtc) -> Promise<RewardProfileRow>
  updateRewardProfile(transaction, {playerId, profile, nowUtc}) -> Promise<RewardProfileRow>
  getLegacySave(pool, identity, dependencies) -> Promise<{status:200, archive:{schemaVersion:2,revision:number,state:GameStateV2,trust:'unverified'}}|{status:404,code:'legacy-save-not-found'}>
  ```
- **Data & Schema Fields**:
  - `dbo.PlayerRewardProfiles`: `PlayerId uniqueidentifier PK/FK Players`, `Level int`, `Xp decimal(16,0)`, `XpToNext decimal(16,0)`, `PendingLevelUps int`, `Gold decimal(16,0)`, `Materials decimal(16,0)`, `InventoryJson nvarchar(max)`, `Chapter int`, `CurrentStage int`, `UnlockedChapter int`, `UnlockedStage int`, `ClearedStageIdsJson nvarchar(max)`, `UpdatedAtUtc datetime2`. API bounds numeric values to JS safe integers; constraints enforce nonnegative values, positive level/xp threshold, valid stage 1–10.
  - `dbo.LegacySaveArchives`: `ArchiveId uniqueidentifier PK`, `PlayerId FK`, `OriginalRevision bigint`, `OriginalSaveJson nvarchar(max)`, `ArchivedAtUtc datetime2`, `Reason nvarchar(32)`; unique filtered key prevents duplicate migration archive for a player.
  - default canonical profile is level 1, xp 0, xpToNext 100, pending 0, gold/materials 0, empty inventory, chapter/stage/unlocks 1, empty cleared IDs.
- **Execution Flow / Logic**:
  1. Migration archives each existing CloudSaves row before profile seeding, then inserts a default reward profile for each player with a CloudSave. It does not rewrite or delete original save JSON. Record schema version 5 in one transaction.
  2. `mergeRewardProfile` replaces only server-owned fields in a copied v2 save: player level/xp/xpToNext/pendingLevelUps, top-level gold/materials/inventory, progression fields. Preserve currentHp, baseStats, available/spent stat points, reset count, equipment.
  3. Change `parseCloudSave(row, rewardProfile)` to canonicalize v2 then merge; existing `GET /saves/current` returns merged state. A missing profile for a newly created save is inserted with defaults in the same create transaction.
  4. Existing `PUT /saves/current` validates the full v2 envelope, then stores `mergeRewardProfile(validatedClientState, lockedRewardProfile)` under existing `expectedRevision` CAS. Client-supplied server-owned values are ignored, not copied to the profile.
  5. Authenticated `GET /profile/legacy-save` returns only that identity's archived original `{schemaVersion:2, revision, state, trust:'unverified'}`; return 404 when no archive exists. It never writes the archive into canonical profile storage.
  6. Repository methods used by stage tickets and snapshots must read the merged state through the same domain helper; avoid separate divergent merge rules.
- **Error & Exception Handling**: missing/corrupt profile row is a server error, not a fallback to client values. CAS conflict stays 409 and returns the current merged envelope. Failed profile or save writes rollback together.
- **State Transition & Return**: callers receive the normal CloudSave envelope shape `{schemaVersion:2, revision, updatedAtUtc, state}` with canonical fields merged.

### I02. CloudSave service tests

- Related Files:
  - `api/src/services/cloudSaveService.js` :: `getCurrent`, `putCurrent`; modify
  - `api/test/cloudSave/cloudSaveService.test.js` :: server field overwrite, archive/bootstrap, CAS; modify
  - `api/test/cloudSave/cloudSaveFunction.test.js` :: unchanged public envelope and 409 shape; modify only if needed
  - `api/test/profileArchives/legacySaveRecovery.test.js` :: identity scoping and unverified response; new

#### Details
- Seed a client request with inflated gold/xp/inventory/progression; assert GET after PUT returns canonical profile values while client-owned equipment/baseStats survive.
- Verify a save with no canonical profile receives defaults and never imports old v2 reward values.
- Verify existing archive remains byte-for-byte equal to old SaveJson and repeated bootstrap does not add archives.
- Verify the legacy recovery endpoint returns the archived v2 state only to its owner and labels it unverified.
- Verify failed CAS leaves both profile and CloudSave revision unchanged.

## Acceptance Criteria
- [x] Existing saves are archived before baseline reward profiles are created.
- [x] Account owners can retrieve an archived legacy save for local-only recovery without promoting it.
- [x] GET, PUT, stage ticket and snapshot consumers use one merge contract.
- [x] CloudSave PUT cannot raise or overwrite canonical reward/progression fields.
- [x] Existing client-owned fields and revision conflict recovery remain intact.

## Validation
- `node --test test/cloudSave/cloudSaveService.test.js test/cloudSave/cloudSaveFunction.test.js test/profileArchives/legacySaveRecovery.test.js` (workdir: `api`) — focused profile merge/recovery tests pass
- `npm test` (workdir: `api`) — API suite passes
- SQL migration review — archive precedes profile seeding and does not delete legacy SaveJson

## Commit Message
```text
feat(api): persist authoritative reward profiles

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P02-authoritative-rewards-api
Task: T04-authoritative-profile-storage

- Separate verified rewards from client-owned save fields
- Preserve unverifiable v2 saves as recovery archives
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- Validation: focused profile/recovery tests 22 passed; API suite 123 passed; Function entry check passed; SQL migration review confirmed original save bytes are copied before profile seeding and never rewritten.
- commit: pending
