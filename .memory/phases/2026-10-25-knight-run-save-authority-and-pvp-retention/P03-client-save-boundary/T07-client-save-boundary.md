# Task: T07 계정별 verified save와 offline shadow 분리

## Status: pending

## Goal
로그인 계정의 canonical server save와 오프라인/게스트 진행을 계정별로 분리한다. 재접속 때 미검증 XP·재화·아이템·진행도를 CloudSave PUT으로 자동 승격하지 않으며 원본은 복구 가능하게 보존한다.

## Decision Summary
- API 응답은 verified online state, 네트워크 불가/게스트는 local unverified shadow다.
- Entra tenant/object 계정 키와 generation guard를 유지하고, active account를 바꾼 비동기 응답은 계속 무시한다.

## Implementation

### I01. Coordinator 저장 모드 및 payload projection

- Related Files:
  - `src/game/domain/accountSaveCoordinator.js` :: `loadAccountSave`, `putInitialState`, `performSync`, `saveLocal`, `syncPendingSave`; modify
  - `src/game/domain/saveStore.js` :: schema-v2 serialization, account save keys, archive helpers; modify
  - `src/api/cloudSaveClient.js` :: `getCurrent`, `putCurrent`, `getLegacySave`; authenticated save and read-only recovery API; modify
  - `src/game/domain/rankedRunClient.js` :: `syncBeforeTicket`, `prepareStage`, `submitResult`; modify
  - `src/game/domain/stateFactory.js` or app bootstrap owner :: coordinator creation and guest mode; read/modify only if mode contract needs wiring

#### Details
- **Signatures & Types**:
  ```ts
  type SaveMode = 'verified-online'|'offline-unverified'|'guest-unverified';
  type CoordinatorResult = {status:'ready', mode:SaveMode, state:GameStateV2, revision:number|null, hasUnverifiedShadow:boolean};
  createAccountSaveCoordinator({...}) -> {
    loadAccountSave(account), refreshAccountSave(), saveLocal(state),
    syncPendingSave(), applyVerifiedState(envelope), selectLocalShadow(reason, {preferExisting=true}), getMode(), getSaveRevision()
  }
  ```
- **Data & Schema Fields**:
  - Keep existing account-specific v2 key as offline shadow, add an account-specific `:verified-backup:v1` serialized envelope key and metadata marker `{trust:'verified'|'unverified', revision, pending}`.
  - Preserve the pre-transition raw local state under existing recovery key before writing either new key. Do not include an unverified trust marker in API request body; server remains authority.
- **Execution Flow / Logic**:
  1. On authenticated GET success, validate and install merged server envelope as active `verified-online` state. Save a verified backup with its server revision.
  2. If an offline shadow differs, retain it under its account key and expose `hasUnverifiedShadow:true`; do not auto-merge or PUT it. Existing 409 behavior backs up local state and installs server current state.
  3. On network failure, load only the active account's offline shadow as `offline-unverified`. Guest/no identity uses `guest-unverified` and never calls authenticated profile APIs.
  4. `saveLocal` persists the active mode's data. In verified mode, serialize a client-owned projection (currentHp/baseStats/stat allocation/equipment) for PUT; canonical profile fields are always reconstructed from latest API envelope and never uploaded as authoritative writes.
  5. Browser `online` event refreshes canonical server state and keeps shadow for explicit recovery; it does not run a whole-state replay upload. Remove auto retry loop that would PUT the shadow indefinitely.
  6. `selectLocalShadow(reason, {preferExisting=true})` activates the account's existing offline shadow if present; otherwise it clones the latest verified state as the initial shadow base. It switches mode to `offline-unverified` and records the fallback reason without merging the two states. This is used when an online stage cannot obtain a server ticket; local rewards must not be written back to the verified save.
  7. `applyVerifiedState(envelope)` checks active generation/account, validates revision, atomically installs merged state and notifies snapshot publisher. A stale generation returns `stale-account-operation`.
  8. `rankedRunClient.syncBeforeTicket` requires `verified-online`, flushes client-owned fields only, refreshes canonical state, then requests ticket with current revision.
- If no local shadow exists, legacy recovery is read only after an explicit TownScene choice. Store the returned v2 payload as an offline shadow and set `offline-unverified`; never call CloudSave PUT with it. When using the last verified backup offline, retag the active copy as unverified before allowing local writes.
- **Error & Exception Handling**: invalid envelope never replaces backup; storage failure returns explicit `storage-unavailable`; auth failures stay distinct; network failure leaves existing shadow available. No local recovery copy is deleted as part of login.
- **State Transition & Return**: a shadow may be manually recovered as local play but cannot become verified via automatic sync. Only a successful server action/result envelope changes canonical reward fields.

### I02. Account/offline regression tests

- Related Files:
  - `test/save/accountSaveCoordinator.test.js` :: trust modes and account isolation; modify
  - `test/ranked-stage-client.test.js` :: ticket requires verified mode; modify
  - `test/save/saveStore.test.js` :: verified backup and legacy recovery; modify

#### Details
- Test authenticated online, offline after previous login, new guest, guest local server, account switch during GET/PUT, CAS conflict, existing v1→v2 migration, and shadow present on reconnect.
- Assert no network call carries inflated server-owned fields and no `online` event promotes a shadow.

## Acceptance Criteria
- [ ] Verified online state and unverified shadow are separately keyed and account-scoped.
- [ ] Offline and guest progress remains playable and recoverable.
- [ ] Reconnect and CAS conflict never silently overwrite canonical server rewards.
- [ ] Ticket request cannot use an unverified profile as a verified starting save.

## Validation
- `node --test test/save/accountSaveCoordinator.test.js test/ranked-stage-client.test.js test/save/saveStore.test.js` (workdir: repository root) — focused browser persistence tests pass
- `npm test` (workdir: repository root) — full root suite passes
- `npm run build` (workdir: repository root) — client bundle builds

## Commit Message
```text
feat(save): separate verified profile from offline progress

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P03-client-save-boundary
Task: T07-client-save-boundary

- Keep account-scoped offline shadows recoverable
- Prevent automatic promotion of unverified rewards
```

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
