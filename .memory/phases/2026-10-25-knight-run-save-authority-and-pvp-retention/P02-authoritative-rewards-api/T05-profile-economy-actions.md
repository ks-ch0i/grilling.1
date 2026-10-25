# Task: T05 프로필 재화·인벤토리 명령

## Status: done

## Goal
서버 권위 인벤토리에서 아이템을 장착/분해 대상으로 이동하고, 골드·재료를 소비하는 요청을 인증된 revision과 idempotency key로 처리한다. CloudSave PUT 경로에서는 재화 증가나 아이템 조작을 허용하지 않는다.

## Decision Summary
- 허용 command는 `equip-inventory-item`, `dismantle-inventory-item`, `spend-gold`, `spend-materials` 네 가지다.
- 장비의 결과 능력치와 강화 난수는 여전히 client-owned다. 이 API는 canonical 아이템 제거와 재화 차감만 보장한다.

## Implementation

### I01. API contract, transaction, idempotency

- Related Files:
  - `api/migrations/006-profile-action-ledger.sql` :: idempotency ledger; new
  - `api/src/domain/profileAction.js` :: request validation and result codes; new
  - `api/src/repositories/profileActionRepository.js` :: lock/CAS/action ledger; new
  - `api/src/services/profileActionService.js` :: `applyProfileAction`; new
  - `api/src/functions/profileActions.js` :: authenticated HTTP handler; new
  - `api/src/index.js` :: handler registration; modify
  - `api/test/profileActions/` :: validation/service/function/repository tests; new

#### Details
- **Signatures & Types**:
  ```ts
  type Action =
    | {type:'equip-inventory-item', itemId:string}
    | {type:'dismantle-inventory-item', itemId:string}
    | {type:'spend-gold', amount:number}
    | {type:'spend-materials', amount:number};
  type Request = {actionId:string, expectedSaveRevision:number, action:Action};
  applyProfileAction(pool, identity, body, dependencies) -> Promise<{status:number, code?:string, revision?:number, appliedRevision?:number, state?:GameStateV2, consumedItem?:GearItem, materialsGained?:number, criticalSuccess?:boolean}>;
  ```
- **Data & Schema Fields**:
  - `PlayerProfileActions`: `PlayerId uniqueidentifier NOT NULL FK Players`, `ActionId uniqueidentifier NOT NULL`, `RequestJson nvarchar(2048) NOT NULL`, `ResultJson nvarchar(max) NOT NULL`, `AppliedAtUtc datetime2 NOT NULL`, composite `PRIMARY KEY(PlayerId,ActionId)`. Action receipt retains the applied revision and any consumed item for retries.
  - Dismantle base yield is rarity-indexed `[common:1, uncommon:2, rare:4, unique:8, legendary:16]`, matching `src/game/domain/gear.js` `MATERIAL_YIELD`; preserve its 5% critical-success double-yield behavior with server-side cryptographic randomness.
- **Execution Flow / Logic**:
  1. `POST /api/profile/actions` authenticates with the existing identity helper and validates UUID `actionId`, positive `expectedSaveRevision`, action discriminator, safe integer amount, and item ID length.
  2. In one transaction, look up `(PlayerId,ActionId)` first. Exact same `RequestJson` returns the stored action receipt plus the latest merged profile/revision; same id with different request returns 409 `action-id-conflict`.
  3. Lock `Players`, `CloudSaves`, and `PlayerRewardProfiles`; compare expected revision with CloudSaves.Revision. Mismatch returns 409 `save-revision-conflict` plus latest merged save.
  4. Equip requires the item in canonical inventory, removes it, and returns its canonical item JSON for client equipment save. Dismantle removes that item, rolls the existing 5% critical chance server-side, and adds base rarity yield or double yield to materials. Spend commands subtract only a positive amount no greater than current balance; they never trust a requested resulting balance.
  5. Merge updated profile with current client-owned save, update profile and CloudSaves and increment the shared revision exactly once. Insert action result ledger before commit.
- **Error & Exception Handling**: 400 `invalid-action`, 404 `profile-not-found`/`inventory-item-not-found`, 409 `save-revision-conflict`/`action-id-conflict`, 422 `insufficient-gold`/`insufficient-materials`/`profile-overflow`. No ledger row or state mutation survives rollback.
- **State Transition & Return**: repeated same action ID returns the original receipt and latest merged state without applying a second debit or inventory removal.

### I02. Command tests

- Validate duplicate same/different action IDs, stale revision, missing item, all rarity yields, exact-balance spend, overspend, safe-integer overflow, and transaction rollback.
- Verify a caller cannot add gold/materials or submit a resulting inventory/profile value.
- Client-side reset/upgrade preview must validate eligibility before calling spend; a failed preview must never debit the server profile.

## Acceptance Criteria
- [x] Every command is bound to authenticated PlayerId, action ID, and CloudSave revision.
- [x] Item transfer/dismantle and balance spend update profile and CloudSave atomically.
- [x] Retrying a committed request cannot spend twice or remove two items, and returns current profile state with the original action receipt.
- [x] Client cannot use these commands to increase a balance or invent inventory entries.

## Validation
- `node --test test/profileActions/*.test.js` (workdir: `api`) — 17 tests pass
- `npm test` (workdir: `api`) — API suite passes
- `npm run check` (workdir: `api`) — registered Function entry parses

## Commit Message
```text
feat(api): add idempotent profile economy actions

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P02-authoritative-rewards-api
Task: T05-profile-economy-actions

- Protect inventory transitions and resource spending
- Bind retries to action id and save revision
```

## Progress
- [x] 구현 완료
- [x] 검증 통과: API 141, root 178; API check와 Vite build 통과
- commit: c06d1ab
