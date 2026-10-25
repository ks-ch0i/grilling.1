# Task: T08 게임 화면 보상 결과 통합

## Status: done

## Goal
전투 완료 후 서버 확인 전에는 온라인 canonical 보상을 확정하지 않고, verified 응답이 오면 서버 state/revision으로 교체한다. profile action을 통해 아이템 이동·분해와 골드/재료 차감을 처리하며 네트워크 실패 시 unverified local shadow에 남긴다.

## Decision Summary
- BattleScene의 기존 즉시 로컬 보상은 verified ticket이 있을 때 provisional delta로 보관한다. offline/unranked/guest는 local shadow에 현재 게임 규칙대로 적용한다.
- 모델 2의 남은 client-owned 장비 stats/baseStats를 서버 검증된 것으로 표시하지 않는다.

## Implementation

### I01. Stage ticket 결과와 전투 장면

- Related Files:
  - `src/game/scenes/BattleScene.js` :: `defeatEnemy`, `dropGear`, `collectDrops`, `finishStage`, `submitRankedClear`, game-over path; modify
  - `src/game/domain/rankedRunClient.js` :: `submitResult` verified response shape; modify
  - `src/game/domain/progression.js` :: existing local reward functions for offline mode; preserve/use
  - `src/game/domain/accountSaveCoordinator.js` :: `applyVerifiedState`, save mode; use

#### Details
- **Signatures & Types**:
  ```ts
  submitResult(ticket, inputs) -> Promise<
    {verified:true, outcome:'clear'|'death', revision:number, state:GameStateV2, rewards:RewardSummary}
    | {verified:false, code:string}
  >
  ```
- **Execution Flow / Logic**:
  1. For a verified ticket, continue deterministic local simulation and input recording but store kill XP/gold/drops/clear progression as provisional; never call canonical `saveLocal` with those deltas before server result.
  2. Submit valid input for both terminal clear and death. If the user leaves before terminal completion, preserve existing abandon semantics and do not grant authoritative rewards.
  3. On verified 200, merge server `state` with local client-owned equipment/stat fields only where the response revision matches the active account generation. Save via `applyVerifiedState`; update TownScene clear target and reward notice from response.
  4. On network error/expired ticket/invalid replay, move the provisional result into the account's unverified shadow and show the existing ranked-unavailable status with a clear “local only” reason. Do not later submit its reward JSON; a still-valid retained input ticket may retry the same input only.
  5. If an online account cannot get a stage ticket, call `selectLocalShadow(reason)` before the battle starts. For no-ticket/offline/guest runs, keep existing `grantXp`, `grantGold`, drop, pickup and `completeStage` local behavior. This path is always marked unverified.
  6. Avoid duplicate visual or data grants when an HTTP retry returns the stored reward envelope. The response state replaces server-owned fields rather than adding `rewards` a second time.
- **Error & Exception Handling**: `match-payload-expired` applies only to PvP and must not be mapped as a stage result. Stage `run-expired`, `run-not-cleared`, `run-too-fast`, auth failure and network failure each preserve local shadow without canonical update.
- **State Transition & Return**: online verified result advances canonical state exactly once; offline/unverified result is playable and recoverable but never affects future ranked ticket profile.

### I02. Town inventory/resource actions

- Related Files:
  - `src/api/cloudSaveClient.js` :: `applyProfileAction(account, request)`; implement/modify
  - `src/game/scenes/TownScene.js` :: equipment inventory/stat reset handlers and explicit legacy local recovery choice; modify
  - `src/game/domain/gear.js` :: equip/dismantle/upgrade local calculations; keep client-owned outputs and request server item/resource transition before save
  - `test/battle-reward-flow.test.js` :: verified/offline result behavior; new
  - `test/town-profile-actions.test.js` :: action ID, revision and retry UI/client contract; new

#### Details
- For a verified account, `equipGear` first calls `equip-inventory-item`; on success it uses the returned canonical item and saves only the new equipment client-owned field at the returned revision.
- `dismantleGear` calls `dismantle-inventory-item`; use the server returned materials/profile state and do not independently increment canonical materials.
- `upgradeGear` and `resetStatPoints` first validate the current item/points and compute the local result without applying it. If valid, generate a UUID `actionId`, request `spend-materials` or `spend-gold`, then commit the precomputed client-side result. Reuse the same action ID for retries of one UI action.
- After a spend action, keep canonical gold/materials/inventory from the server response and apply only the client-owned equipment or base-stat/stat-allocation fields from the preview result.
- If an API action fails, do not mutate verified balances/equipment. Offline/guest mode may run the old local functions, but the resulting state remains unverified.
- On 409 revision conflict install the current server envelope, preserve the attempted local action for user retry, and do not auto-repeat with a new action ID.
- When an archived legacy save is available and no local shadow exists, offer “미검증 로컬 저장으로 계속” versus verified server profile. Choosing legacy loads it into the account's offline shadow and disables ticket acquisition until the player returns to the verified profile.
- When a local shadow already exists, offer explicit “검증된 온라인 저장” and “미검증 로컬 진행” choices; preserve both copies and never merge their reward/progression fields.

## Acceptance Criteria
- [x] Verified stage rewards are committed only from server result state, once per run.
- [x] Valid clear and death submit recorded inputs; offline/guest rewards stay local and unverified.
- [x] Inventory/resource commands use action IDs and server revisions before local gear/stat side effects.
- [x] Existing local guest play still opens the town and game screens without authenticated APIs.
- [x] UI never labels client-owned baseStats/equipment as server-verified.

## Validation
- `node --test test/battle-reward-flow.test.js test/ranked-stage-client.test.js test/town-profile-actions.test.js` (workdir: repository root) — focused result/action tests pass
- `npm test` (workdir: repository root) — full root suite passes
- `npm run build` (workdir: repository root) — client build passes
- API counterpart: `npm test` (workdir: `api`) — profile action and stage result tests pass

Validation results: focused client/action tests 55 passed; root suite 191 passed; API suite 148 passed; Vite production build passed (existing Phaser chunk-size warning).

## Commit Message
```text
feat(game): apply verified rewards and profile actions

Plan: 2026-10-25-knight-run-save-authority-and-pvp-retention
Phase: P03-client-save-boundary
Task: T08-gameplay-reward-integration

- Keep online rewards provisional until server confirmation
- Route canonical inventory and resource changes through profile actions
```

## Progress
- [x] 구현 완료
- [x] 검증 통과
- commit: `861c617`
