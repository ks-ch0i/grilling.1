# Task: T03 장비 드롭과 강화 경제

## Status: in_progress

## Goal

마을과 전투가 공통으로 사용할 장비 도메인 함수를 만들어 무작위 장비 획득, 장착, 20칸 인벤토리, 분해 재료, 레벨 30 강화를 동일한 규칙으로 동작하게 한다.

## Decision Summary

- 상태 타입은 T02의 `GearItem`/`GameState`를 그대로 사용한다. Phaser Scene에서 확률이나 장비 능력치를 직접 계산하지 않는다.
- RNG는 각 함수의 선택 입력으로 주입 가능하게 하고 기본값은 `Math.random`으로 둬 재현 가능한 브라우저 디버깅을 허용한다.

## Implementation

### I01. 장비 생성·등급·효과

- Related Files:
  - `src/game/domain/gear.js` :: `rollRarity`, `rollGear`, `createStarterEquipment`, `getGearStatSummary`; new
  - `src/game/domain/stateFactory.js` :: `createInitialState`; new
  - `src/game/data/balance.js` :: 효과/장비 밸런스 table; modify

#### Details
- Signatures:
  ```js
  export function rollRarity(stageIndex, rng = Math.random)
  export function rollGear({ stageIndex, rng = Math.random, idFactory })
  export function createStarterEquipment(idFactory)
  export function getGearStatSummary(item)
  export function createInitialState(idFactory)
  ```
- `rollGear`는 슬롯 6종과 등급 5종을 결정해 `GearItem`을 반환한다. 슬롯은 균등 확률, 등급은 T02의 stage 1~10 보간표를 사용한다. stageIndex는 1..10로 제한한다.
- 커먼 템플릿 stat마다 ±25% 균등 난수를 곱하고 희귀도 배율을 적용한다. HP/공격력/방어력은 올림 정수, 확률·배율·속도 값은 소수 여섯째 자리까지 저장한다. 생성 후 값은 아이템에 저장하고 재로드 때 reroll하지 않는다.
- 고유 효과는 unique/legendary에서만 생성한다. Unique effect count: 1개 80%, 2개 20%. Legendary: 1개 50%, 2개 40%, 3개 10%. 효과 카탈로그는 `bonusDamage`, `lifeSteal`, `damageReduction`, `thorns`; 아이템 내 중복 ID는 금지한다.
- 등급별 효과 값은 effect별 `BALANCE.effectValues[effectId][rarity]`에서 가져온다. 첫 버전 값 (rarity 순 common→legendary): bonusDamage `[0.05,0.08,0.12,0.18,0.25]`, lifeSteal `[0.02,0.03,0.05,0.08,0.12]`, damageReduction `[0.02,0.03,0.05,0.08,0.12]`, thorns `[0.03,0.05,0.08,0.12,0.18]`. 효과 개수와 ID 조합은 생성 시 확정되어 장비에 저장된다.
- `createStarterEquipment`는 모든 슬롯에 common template gear를 생성한다. 각 item level은 1이고, 효과 배열은 비어 있다. 이 시작 장비는 초기 랜덤 드롭/등급 roll을 사용하지 않는다.
- `createInitialState`는 플레이어 level1/xp0/full HP, 장비 6칸 채움, 빈 inventory, materials0, progression 1-1/unlocked 1-1 상태를 반환한다.

### I02. 장착, 분해, 강화, 파생 능력치

- Related Files:
  - `src/game/domain/gear.js` :: `equipGear`, `dismantleGear`, `upgradeGear`, `derivePlayerStats`, `tryStoreDrop`; modify

#### Details
- Signatures:
  ```js
  export function equipGear(state, itemId)
  export function dismantleGear(state, itemId, rng = Math.random)
  export function upgradeGear(state, itemId, rng = Math.random)
  export function derivePlayerStats(state)
  export function tryStoreDrop(state, item)
  ```
- `equipGear` removes selected item from inventory, puts old slot item into inventory, and returns `{ok:true,state}`. If replacement would exceed 20 inventory items, return `{ok:false,reason:'inventory-full'}` without mutation.
- `dismantleGear` only accepts an inventory item; equipped items cannot be dismantled. Base material yield by rarity is `[1,2,4,8,16]`; 5% success doubles yield. Return `{ok:true,state,materialsGained,criticalSuccess}`.
- `upgradeGear` requires an inventory or equipped gear ID and enough materials. Maximum level 30. First 1→2 cost 10. To compute next-level cost for target level `n`, start at 10 for n=2 and apply each target level in sequence: multiply by 1.2 normally; when n%10===0 multiply by 2 instead; otherwise when n%5===0 multiply by 1.5 instead. Apply exactly one multiplier per level and `Math.ceil` after each step. Upgrade consumes cost and succeeds with no failure.
- On unique/legendary, uniformly select one of `stat-only`, `effect-only`, `both`; on other rarities use `stat-only`. Pick one available stat and/or effect uniformly from that item. Increase each selected value by a random 1–5% of its current value, never decrease. Keep values to six decimal places and enforce critChance max 1. Item effect IDs do not change.
- `derivePlayerStats` adds base stats and equipped item stats. Apply passive effects during combat via T04. Clamp only crit chance to 1. Horse `moveSpeedPercent` multiplies base move speed; other slots cannot modify speed.
- `tryStoreDrop` adds the item when inventory length <20; otherwise returns `{ok:false,reason:'inventory-full',groundItem:item}` without deleting the floor item.
- All functions are immutable: return a new state and do not mutate their input.

## Acceptance Criteria
- [x] New drops get stable IDs, a valid slot/rarity, grade-scaled randomized stats, and eligible fixed effects.
- [x] Starting equipment has all six common slots.
- [x] Equip swaps slots without losing gear; equipped gear cannot be dismantled; inventory capacity is enforced.
- [ ] Salvage, 5% double yield, level cap, threshold costs, and random upgrades follow D05–D06 exactly.

## Validation
- `npm run build` — gear module compiles into the app.

## Revalidation (2026-10-20)
- Source review and inline Node assertions passed for six common starter items, gear ID/slot/rarity creation, equip swap, equipped-item dismantle rejection, 20-item capacity behavior, 5% salvage doubling branch, upgrade level/cost/material consumption, and representative costs at levels 1/4/9/29.
- The full D06 upgrade criterion stays unchecked: this task blueprint specifies a 1–5% increase of each selected value, while current `gear.js` uses `BALANCE.gearUpgrade.specialIncrease` for critical/effect values. Compare that behavior against the later 9/28 balance plan before classifying it as a defect or an intentional update.
- The build passed on Node `v20.19.4`, below the declared supported engine. Town UI scenarios for levels 1/4/5/9/10/29 and full-inventory drop handling remain unverified without a browser; task stays `in_progress`.
- Implementation commit confirmed: `65dde56 feat(game): implement randomized gear and upgrade economy`.
- Manual TownScene validation — roll gear repeatedly, inspect rarity colors/stats, equip, replace, dismantle, and upgrade at levels 1/4/5/9/10/29. Verify full inventory leaves pickup on the ground.

## Commit Message
```text
feat(game): implement randomized gear and upgrade economy

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T03-equipment-economy

- add rarity, slot, and effect rolls
- add inventory, dismantle, and random upgrade rules
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: 65dde56

