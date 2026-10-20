# Task: T02 밸런스와 게임 상태 저장

## Status: in_progress

## Goal

도메인 상태와 첫 버전 밸런스를 한 곳에서 정의하고, 게임 상태를 schema-version이 붙은 JSON으로 브라우저 localStorage에 저장·복구할 수 있게 한다.

## Decision Summary

- 확정 규칙은 결정 문서 D01–D11을 따른다. 이 Task는 상태 형식과 기본 수치만 만든다. 장비 알고리즘은 T03, 전투·진행 함수는 T04다.
- localStorage key는 `lancer-belt-scroll-game:save:v1`; 저장 필드에는 Phaser 객체, 함수, DOM 객체를 넣지 않는다.

## Implementation

### I01. 공유 balance 값과 상태 스키마

- Related Files:
  - `src/game/data/balance.js` :: `BALANCE`, `RARITY`, `RARITY_COLOR`, `GEAR_SLOT`, `STAT_KEYS`; new
  - `src/game/domain/models.js` :: JSDoc typedefs `GameState`, `PlayerState`, `GearItem`, `GearEffect`, `ProgressionState`; new

#### Details
- Export frozen constants:
  ```js
  export const GEAR_SLOT = { HELMET:'helmet', ARMOR:'armor', GLOVES:'gloves', BOOTS:'boots', SPEAR:'spear', HORSE:'horse' };
  export const RARITY = { COMMON:'common', UNCOMMON:'uncommon', RARE:'rare', UNIQUE:'unique', LEGENDARY:'legendary' };
  export const RARITY_COLOR = { common:0x858b91, uncommon:0xf2f2f2, rare:0x4294ff, unique:0xb45cff, legendary:0xffcf45 };
  export const STAT_KEYS = ['maxHp','attack','defense','critChance','critMultiplier','moveSpeedPercent'];
  ```
- `BALANCE` fields/defaults: `canvas:{width:1280,height:720}`, `inventoryCapacity:20`, `basePlayer:{maxHp:100,attack:10,defense:5,critChance:0.05,critMultiplier:2,moveSpeed:200}`, `levelUp:{attack:2,defense:5,maxHp:10}`, `critChanceCap:1`, `gearMaxLevel:30`, `normalEnemyCount:10`, `normalDropChance:0.2`, `bossDropCount:1`, `knockbackPixels:96`, `contactInvulnerabilityMs:0`, `enemyStageGrowth:0.1`, `chapterGrowth:0.5`, `bossMultipliers:{maxHp:5,attack:2,defense:2}`, `healAfterStage:0.5`, `replayXpMultiplier:0.3`.
- Gear rarity multipliers: common 1, uncommon 1.5, rare 2, unique 3, legendary 5. Stage 1 drop weights `[60,25,10,4,1]`, stage 10 `[30,25,20,15,10]`; stage weights interpolate by stage index 1–10.
- Equipment templates (common base before rarity/roll): helmet `{defense:4}`, armor `{defense:8,maxHp:20}`, gloves `{critChance:0.03,critMultiplier:0.15}`, boots `{critChance:0.02,critMultiplier:0.25}`, spear `{attack:8}`, horse `{moveSpeedPercent:0.2}`. Gloves and boots both support both critical options. Each stat rolls independently from 75% to 125% of template and is frozen on item creation.
- `GearItem`: `{id:string,slot:GearSlot,rarity:Rarity,level:number,stats:Partial<Record<StatKey,number>>,effects:GearEffect[]}`. `GearEffect`: `{id:string,value:number}`.
- `PlayerState`: `{level:number,xp:number,xpToNext:number,pendingLevelUps:number,currentHp:number,baseStats:{maxHp:number,attack:number,defense:number,critChance:number,critMultiplier:number,moveSpeed:number}}`. `xp` means progress toward `xpToNext`, not lifetime total.
- `ProgressionState`: `{chapter:number,currentStage:number,unlockedChapter:number,unlockedStage:number,clearedStageIds:string[]}`; stage ID format is `${chapter}-${stage}`.
- `GameState`: `{schemaVersion:1,player:PlayerState,equipment:Record<GearSlot,GearItem|null>,inventory:GearItem[],materials:number,progression:ProgressionState}`. Runtime positions/enemy objects are excluded.
- Numeric policy: HP/attack/defense are integer-valued at display and damage time; probabilities/multipliers may be decimal. Keep rolled/upgraded gear values to six decimal places and display to two decimal places. Use `Math.ceil` for material/XP requirements and clamp damage at zero.

### I02. localStorage repository

- Related Files:
  - `src/game/domain/saveStore.js` :: `loadGameState`, `saveGameState`, `removeSavedGame`; new

#### Details
- Signatures:
  ```js
  export function loadGameState(fallbackState, storage = globalThis.localStorage)
  export function saveGameState(state, storage = globalThis.localStorage)
  export function removeSavedGame(storage = globalThis.localStorage)
  ```
- Save key is `lancer-belt-scroll-game:save:v1`. Before writing validate `schemaVersion === 1`, `inventory.length <= 20`, materials are finite and nonnegative, and the six equipment keys exist.
- `loadGameState` parses JSON; if absent, malformed, wrong schema, or invalid top-level shape, return a structured clone of `fallbackState`. Catch parse and storage access errors; do not crash boot. `saveGameState` catches quota/security errors and returns `{ok:false,error:'storage-unavailable'}`; success returns `{ok:true}`.
- `removeSavedGame` removes only the game key. It is provided for reset/debug use; do not add a reset button in this Task.
- Autosave is called on stable state transitions by T07. Refresh during battle resumes saved player/progression in town and restarts current stage from its beginning.

## Acceptance Criteria
- [x] JSDoc schema and constants cover all six gear slots, five rarities, stats, player, inventory, materials, and chapter progress.
- [x] Save/load round-trips plain JSON state and recovers safely from corrupt/unsupported data.
- [x] No Phaser object is stored or returned by `saveStore.js`.

## Validation
- `npm run build` — modules resolve and Vite builds.
- Browser DevTools manual check — call save/load from the later TownScene integration; reload and confirm JSON survives. No standalone automated test files are introduced in this plan.

## Revalidation (2026-10-20)
- Source review confirmed the JSDoc types, six gear slots, five rarities, and the versioned plain-data save projection.
- Inline Node assertions passed for JSON save/load round-trip and malformed JSON fallback using an isolated in-memory storage mock; the production build also passed on Node `v20.19.4` (below the declared `>=22.12.0` engine).
- Browser DevTools reload/persistence scenario remains unverified because no browser surface was available; this task stays `in_progress`.
- Implementation commit confirmed: `ee01e1e feat(game): define game state and local save schema`.

## Commit Message
```text
feat(game): define game state and local save schema

Plan: 2026-09-26-lancer-belt-scroll-game
Phase: P01-playable-game
Task: T02-state-and-save

- add shared balance and serializable state models
- add versioned localStorage repository
```

## Progress
- [x] 구현 완료
- [ ] 검증 통과
- commit: ee01e1e

