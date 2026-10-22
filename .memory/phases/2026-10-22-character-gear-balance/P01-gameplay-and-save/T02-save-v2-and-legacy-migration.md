# Task: T02 저장 v2 모델과 기존 로컬 저장 이행

## Status: pending

## Goal
모든 새 게임 상태를 schemaVersion 2로 저장하고, 기존 v1 로컬/계정 저장을 손실 없이 결정적으로 이행한다. 게임 도메인, 로컬 저장, API 공유 코드가 같은 migration 결과를 사용하게 한다.

## Decision Summary
- v1 level, XP, xpToNext, pendingLevelUps, 재료, 장비 정체성/희귀도/강화레벨, 진행도와 해금은 유지한다. 기존 기본 능력치와 기존 강화 능력치는 새 규칙 기준으로 재산정한다.
- v1 획득 레벨의 미사용 점수는 2 × (level - 1)로 지급한다. spentStatPoints=0, statResetCount=0, gold=0이다. pendingLevelUps는 그대로 두며 아직 확정되지 않은 레벨 점수는 미리 지급하지 않는다.
- 새 장비 값은 새 템플릿 × 희귀도 배율 × 평균 굴림 1.0에서 시작해 level-1번의 평균 강화 증가를 적용한다. 과거 랜덤 강화 경로는 재구성하지 않는다.

## Implementation

### I01. 공유 게임상태 v2와 순수 migration
- Related Files:
  - packages/game-rules/src/saveMigration.js :: validateGameStateV2, migrateGameState — browser/API 공통 구현; new.
  - packages/game-rules/package.json :: ./save export — new export.
  - src/game/domain/models.js :: PlayerState, GameState JSDoc typedefs — v2 fields; modify.
  - packages/game-rules/src/balance.js :: immutable v2 migration constants — T01 output; read-only.

#### Details
- Signatures & Types:
  ~~~js
  validateGameStateV2(state: unknown): boolean
  migrateGameState(state: unknown): GameStateV2

  GameStateV2 = {
    schemaVersion: 2,
    player: PlayerStateV2,
    equipment: Record<GearSlot, GearItem|null>,
    inventory: GearItem[],
    materials: number,
    gold: number,
    progression: ProgressionState
  }
  PlayerStateV2 = PlayerStateV1 & {
    availableStatPoints: number,
    spentStatPoints: number,
    statResetCount: number
  }
  ~~~
- Data & Schema Fields:
  - availableStatPoints, spentStatPoints, statResetCount는 0 이상의 안전한 정수다. gold도 0 이상의 안전한 정수다.
  - 새 상태의 gear stat rounding은 maxHp/attack/defense를 각 강화 단계에서 Math.ceil, fractional stat/effect는 단계마다 소수점 6자리로 고정한다.
- Execution Flow / Logic:
  1. 입력이 schemaVersion 2면 모든 중첩 필드를 검증하고 deep clone하여 반환한다. v1 이외/손상된 값은 TypeError를 발생시킨다.
  2. v1은 현재 저장 validation과 legacy base stats를 기준으로 기존 유효성을 검사한다. 기존 currentHp가 0일 수 있으므로 그대로 허용한다.
  3. oldHpRatio=clamp(v1.currentHp / oldEffectiveMaxHp, 0, 1)을 migration 전에 계산한다. oldEffectiveMaxHp는 legacy baseStats와 저장된 장비 stats 합계에 기존 gear.helmet/armor 등과 동일한 적용 규칙을 사용한다.
  4. 새 player.baseStats는 T01 BALANCE.basePlayer 복사본으로 바꾼다. 현재 HP의 상대 비율을 migration 후 새 equipment 기준 maxHp에 곱하고 올림한다. oldHpRatio가 0이면 새 currentHp도 0이다.
  5. 장착/보유 장비 각각 ID, slot, rarity, level, stat key 집합과 effect ID 집합을 유지한다. 일반 stat은 T01의 강화 평균 밴드로 level-1 단계를 순차 적용한다. 특수 stat/effect는 새 템플릿/rarity effect 기본값에서 시작해 해당 고정 증가량의 평균을 level-1회 더한다. 적용 가능한 확률/피해감소 cap을 적용한다.
  6. migration은 입력을 mutate하지 않고 동일 입력마다 byte-equivalent JSON 결과를 반환한다. 장착/인벤토리 장비 ID가 중복되거나 enum/범위가 유효하지 않으면 거부한다.

### I02. 새 로컬 저장과 레거시 key fallback
- Related Files:
  - src/game/domain/gear.js :: createInitialState — schemaVersion2, stat counters, gold; modify.
  - src/game/domain/saveStore.js :: SAVE_KEY, isValidGameState, readSavedGame, loadGameState, saveGameState, toSaveData — v2 persistence; modify.
  - src/game/domain/accountSaveCoordinator.js :: accountSaveKey, loadAccountSave, offlineResult, installCloudState, saveLocally — account key fallback and v2 persistence; modify.

#### Details
- Schema & Compatibility:
  - New unauthenticated key: lancer-belt-scroll-game:save:v2. Legacy fallback: lancer-belt-scroll-game:save:v1.
  - New account key: lancer-belt-scroll-game:save:v2:{lowercaseTenantId}:{lowercaseObjectId}. Legacy fallback uses the exact same identity suffix with v1.
  - New recovery key prefix is v2; existing v1 recovery entries remain readable as raw backup only and are never overwritten.
- Execution Flow / Logic:
  1. Create initial state with v2, zero gold/points/reset count, and current T01 basePlayer.
  2. Load current v2 key first. If absent, read v1 key, call migrateGameState, then persist to v2 only after successful validation. Keep the old serialized value as recoverable source until v2 write succeeds.
  3. Account coordinator tries current account v2 local save, then same-account v1 key, then the existing legacy-owner guarded shared save key. It must not migrate another Entra identity's save.
  4. Every save serializes only the canonical v2 field list. A v1 payload is never emitted by saveGameState or the account coordinator.
  5. When installing cloud state, validate schemaVersion2 before mutating active state. If v2 save fails, keep the in-memory result and report savedLocally=false using the existing coordinator behavior.

### I03. Migration and persistence regression tests
- Related Files:
  - test/save/saveMigration.test.js :: v1/v2 conversion and invariant tests; new.
  - test/save/accountSaveCoordinator.test.js :: v2 key, v1 fallback and cross-account isolation tests; modify.
  - test/save/saveStore.test.js :: canonical v2 save/load validation; new.

#### Details
- Cover level1 and higher-level records, pending level-ups, zero HP, fractional HP, every gear rarity/level endpoint, missing/invalid gear fields, duplicate item IDs, storage write failure, and repeated migration idempotency.
- Assert gear ID/slot/rarity/level/effect IDs and progression/materials are preserved; v1 gold becomes 0; points equal 2 × (level - 1); player base stats match v2 BALANCE.
- Assert v1 shared saves are imported only when legacy owner is absent or matches active identity; another account's v1 key is ignored.

## Acceptance Criteria
- [ ] Initial and saved game states validate only under schemaVersion2.
- [ ] Existing local save migration is deterministic, idempotent, and retains all decided fields.
- [ ] A failed v2 write never deletes or overwrites the v1 source.
- [ ] Account save migration cannot cross tenant/object identities.

## Validation
- node --version — Node.js 22.12.0 이상이어야 한다.
- node --test test/save/saveMigration.test.js test/save/saveStore.test.js test/save/accountSaveCoordinator.test.js — migration과 로컬/계정 저장 테스트가 통과해야 한다.

## Commit Message
~~~text
feat(save): migrate game state to schema v2

Plan: 2026-10-22-character-gear-balance
Phase: P01-gameplay-and-save
Task: T02-save-v2-and-legacy-migration

- Add deterministic legacy character and gear migration
- Preserve v1 local saves while switching writes to v2
~~~

## Progress
- [ ] 구현 완료
- [ ] 검증 통과
- commit: pending
