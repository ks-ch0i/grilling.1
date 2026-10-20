# Current Context

## Active Plan
[마창기사 벨트스크롤 웹게임](./plans/2026-09-26-lancer-belt-scroll-game.md)

## Active Phase
[P01 플레이 가능한 게임](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/phase.md)

## Active Task
[T05 마을 UI](./phases/2026-09-26-lancer-belt-scroll-game/P01-playable-game/T05-town-ui.md)

## Status
- T01 completed on 2026-10-20: isolated Chromium confirmed the TownScene/title, landscape 16:9 layout, and unsupported portrait rotation notice; Node `22.12.0` build passed.
- T02 completed on 2026-10-20: a fresh isolated profile confirmed actual localStorage save/load and persistence across reload; Node `22.12.0` build passed.
- T03 completed on 2026-10-20: isolated Chromium verified rarity presentation, equip/salvage, upgrade thresholds through level 30, and ground-drop retention at full inventory; Node `22.12.0` build passed.
- T03's life-steal value table was reconciled to confirmed 9/28 D01. Existing save data was not accessed or changed; the 9/26 playable-game plan remains incomplete while town, battle-scene, and integration tasks remain.
- T04 completed on 2026-10-20: isolated Chromium verified independent contact damage, stacked gear effects, lethal-contact retry ordering, max-HP level-up, replay XP, boss scaling, and chapter unlock; Node `22.12.0` build passed. The 9/27 lethal-contact decision and 9/28 growth formula are reconciled in its blueprint.

## Next Step (IMPORTANT)
Read the active T05 town UI blueprint and verify its rendering and controls in an isolated browser profile; preserve existing save data.
